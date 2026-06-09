/**
 * Pure decision helpers for the Genkit chat-turn engine.
 *
 * Everything here is deliberately free of Firebase/Genkit *runtime* imports —
 * only erased `import type`s — so it can be exercised under `node --test`
 * without booting the `ai` singleton (`genkitClient.ts` runs
 * `enableFirebaseTelemetry()` + `genkit({...})` at module load) or Firestore.
 * `bot.ts` owns the side-effecting orchestration; this module owns the
 * decisions that engine makes:
 *
 *   - `deliveryToSendArgs` — the one mapping from a turn's *delivery shape*
 *     (fresh prompt / interrupt resume / transfer re-entry) to the args
 *     `chat.sendStream(...)` receives. Single-sourced so `runChatTurn` can
 *     pick a shape without re-typing the sendStream contract.
 *   - The three recoverable-error classifiers (`isToolIterationsExceededError`,
 *     `getMissingToolName`, `isToolInputValidationError`) — the predicates
 *     `streamChatToClientInner` uses to convert a turn-aborting `GenkitError`
 *     into a graceful, user-visible fallback instead of an opaque `INTERNAL`.
 *   - `buildTurnConfig` — the per-provider sampling/`thinking` config
 *     assembly shared by the streaming turn and (eventually) the one-shot
 *     structured generations, with the optional temperature clamp the
 *     summary path needs.
 *
 * Keeping these pure means the four documented Genkit sharp edges
 * (stream-abort mirrored on both channels; tool-arg `INVALID_ARGUMENT`;
 * `output:{schema}` -> `INTERNAL` masking; lazy session persist) are pinned
 * by a `node --test` truth table rather than by reviewer vigilance.
 */

import type { Part, ResumeOptions } from "genkit/beta"

import type { AiProvider } from "./domain.js"

// ===========================================================================
// Delivery -> sendStream args
// ===========================================================================

/**
 * The three genuinely different ways a streaming chat turn is kicked off,
 * collapsed to one tagged union so `runChatTurn` owns the AbortController /
 * deadline / `maxTurns` policy once and each caller only declares its shape:
 *
 *   - `{ prompt }`            — a fresh user turn (interactive send, or the
 *                              first turn of a headless run). `prompt` is a
 *                              plain string, or `[text, ...media]` parts for
 *                              a multimodal turn.
 *   - `{ resume }`           — re-enter a paused Human-in-the-Loop turn with
 *                              the user's answer folded in as a tool response
 *                              (`respondToBotInterrupt`).
 *   - `{ kind: "continue" }` — re-enter a truncated thread with NO new input,
 *                              so the model just replies to the message at the
 *                              tail (the transfer re-entry second turn).
 */
export type TurnDelivery =
  | { prompt: string | Part[] }
  | { resume: ResumeOptions }
  | { kind: "continue" }

/**
 * The delivery-specific slice of `chat.sendStream(...)`'s argument object —
 * exactly `prompt` xor `resume` xor neither. `runChatTurn` spreads this and
 * adds the turn-stable `abortSignal` + `maxTurns`, so this never carries
 * those (a test asserts the boundary).
 */
export interface ChatSendArgs {
  prompt?: string | Part[]
  resume?: ResumeOptions
}

/**
 * Map a {@link TurnDelivery} to the delivery slice of the sendStream args.
 * `{ kind: "continue" }` yields `{}` — Genkit then generates on the
 * (truncated) thread alone, which is precisely what the transfer second
 * turn wants.
 */
export function deliveryToSendArgs(delivery: TurnDelivery): ChatSendArgs {
  if ("prompt" in delivery) return { prompt: delivery.prompt }
  if ("resume" in delivery) return { resume: delivery.resume }
  return {}
}

// ===========================================================================
// Recoverable-error classifiers
// ===========================================================================

/**
 * Shape of the `GenkitError` fields these classifiers read. Genkit stamps a
 * coarse `status` plus a human message (sometimes only `originalMessage`
 * once it has been wrapped), so each predicate narrows past the status with
 * a canonical message substring to avoid swallowing unrelated errors that
 * happen to share the same status.
 */
interface GenkitErrorLike {
  status?: string
  originalMessage?: string
  message?: string
}

function errorMessage(err: GenkitErrorLike): string {
  return err.originalMessage ?? err.message ?? ""
}

/**
 * Detect Genkit's "model exhausted its tool budget" error so the chat
 * flow can convert it into a user-visible message instead of letting
 * `onCallGenkit` wrap it as `INTERNAL`.
 *
 * Matches on `status === "ABORTED"` AND the message string mentioning
 * tool-iteration exhaustion — narrowing past `ABORTED` alone, which
 * Genkit also uses for legitimate user-initiated cancellations that
 * should keep propagating.
 */
export function isToolIterationsExceededError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as GenkitErrorLike
  if (e.status !== "ABORTED") return false
  return errorMessage(e).includes("maximum tool call iterations")
}

/**
 * Detect Genkit's "model called a tool not registered this turn" error.
 * Happens when the model's continuation emits a tool request whose name
 * isn't in the current `chat({ tools })` catalog — most commonly on a
 * resume turn where the catalog changed since the historical thread was
 * written (e.g., the user switched to an agent with fewer tools while an
 * `askQuestion` interrupt was pending, so the resume runs without the
 * node-CRUD tools that earlier turns successfully used).
 *
 * Status-narrowed past plain `NOT_FOUND` AND matched on the canonical
 * "Tool X not found" message so we don't accidentally swallow unrelated
 * NOT_FOUND errors (e.g. session/model lookup misses elsewhere in the
 * generate pipeline). Returns the offending tool name so the fallback
 * chunk can name it for the user.
 */
export function getMissingToolName(err: unknown): string | null {
  if (!err || typeof err !== "object") return null
  const e = err as GenkitErrorLike
  if (e.status !== "NOT_FOUND") return null
  const match = /Tool (\S+) not found/.exec(errorMessage(e))
  return match ? match[1] : null
}

/**
 * Detect Genkit's "the model called a tool with arguments that fail its input
 * schema" error — a numeric field over a `.max()`, a bad enum, a missing
 * required field, etc. Genkit validates tool-call args against the schema
 * BEFORE the handler runs and throws `INVALID_ARGUMENT: Schema validation
 * failed …`, which (like the two errors above) mirrors onto the stream channel
 * and would otherwise escape as an opaque `INTERNAL` / land as the terminal
 * error of a headless Workflows run.
 *
 * Status-narrowed past plain `INVALID_ARGUMENT` AND matched on the canonical
 * "Schema validation failed" wording so we don't swallow unrelated
 * INVALID_ARGUMENTs from elsewhere in the generate pipeline. We can't resume
 * the turn — Genkit already aborted the whole generate — so the caller turns
 * this into a graceful, logged fallback rather than a cryptic crash. The real
 * fix for any given tool is to clamp/relax its schema so the model can't trip
 * it (see `clampSearchLimit` in botRag.ts); this is the catch-all backstop for
 * tools that haven't been hardened that way yet.
 */
export function isToolInputValidationError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as GenkitErrorLike
  if (e.status !== "INVALID_ARGUMENT") return false
  return errorMessage(e).includes("Schema validation failed")
}

// ===========================================================================
// Per-provider sampling / thinking config assembly
// ===========================================================================

/**
 * Thinking budget (tokens) requested from Anthropic when extended thinking
 * is enabled. Must be >= 1024 (Anthropic's minimum). Gemini manages its own
 * budget dynamically, so this is Anthropic-only. We add it on top of the
 * agent's `maxOutputTokens` so the answer keeps its full allotment.
 */
export const ANTHROPIC_THINKING_BUDGET_TOKENS = 2048

/**
 * Whether a model wire-name exposes chain-of-thought we can surface as
 * `<thinking>` blocks. Gemini gained it in 2.5 (2.0-flash/-lite have none);
 * Claude exposes it on 3.7 and the 4.x line. OpenAI's offered `gpt-4*`
 * aren't reasoning models, so they return nothing to fold — and if a
 * compatible endpoint ever emits `reasoning_content`, the shared fold picks
 * it up regardless of this gate.
 */
export function modelSupportsThinking(name: string): boolean {
  if (/^gemini-(2\.5|3)/.test(name)) return true
  if (/^claude-(3-7|(opus|sonnet|haiku)-4)/.test(name)) return true
  return false
}

/** Sampling knobs read off the team's agent config (all optional). */
export interface TurnSampling {
  temperature?: number
  topP?: number
  topK?: number
  maxOutputTokens?: number
}

/**
 * Build the `config` object handed to `chat(...)` / `ai.generate(...)`,
 * baking in the per-provider thinking enablement so every callsite gets it
 * identically:
 *
 *   - Gemini (2.5+/3): `thinkingConfig.includeThoughts` alongside sampling.
 *   - Claude (3.7/4+): the beta API surface + a `thinking` budget. Anthropic
 *     rejects temperature/top_p/top_k alongside thinking and requires
 *     max_tokens > budget, so we DROP the sampling knobs and add the budget
 *     on top of the agent's answer allotment.
 *   - OpenAI gpt-4*: not reasoning models — sampling only.
 *
 * The stream + reconstruction fold any resulting `reasoning` parts into
 * `<thinking>` blocks uniformly (`createThinkingFolder`), so this only
 * controls how each provider is *asked* to emit reasoning.
 *
 * `temperatureCap` clamps temperature to an upper bound (the one-shot
 * summary path hugs the source at 0.3 even when the team's chat temperature
 * is higher); omit it and temperature passes through unchanged — the
 * streaming chat turn passes nothing, so its config is byte-identical to the
 * pre-extraction inline assembly.
 */
export function buildTurnConfig(opts: {
  provider: AiProvider
  /** Model wire-name — gates `modelSupportsThinking`. */
  model: string
  sampling: TurnSampling
  /** The agent's `thinking` flag; thinking only applies if the model supports it. */
  thinkingEnabled: boolean
  temperatureCap?: number
}): Record<string, unknown> {
  const sampling: TurnSampling = { ...opts.sampling }
  if (opts.temperatureCap !== undefined && sampling.temperature !== undefined) {
    sampling.temperature = Math.min(sampling.temperature, opts.temperatureCap)
  }

  if (!opts.thinkingEnabled || !modelSupportsThinking(opts.model)) {
    return { ...sampling }
  }

  if (opts.provider === "google") {
    return { ...sampling, thinkingConfig: { includeThoughts: true } }
  }

  if (opts.provider === "anthropic") {
    return {
      maxOutputTokens:
        (sampling.maxOutputTokens ?? 0) + ANTHROPIC_THINKING_BUDGET_TOKENS,
      apiVersion: "beta",
      thinking: {
        enabled: true,
        budgetTokens: ANTHROPIC_THINKING_BUDGET_TOKENS,
      },
    }
  }

  // OpenAI (or any future non-reasoning provider): sampling only. Unreachable
  // for `openai` in practice because `modelSupportsThinking` already returned
  // false above, but kept total so the function never falls through.
  return { ...sampling }
}
