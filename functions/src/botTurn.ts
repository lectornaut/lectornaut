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
 *   - `resolveTransferOutcome` — `transferToAgent`'s target-validation
 *     decision. The rejection branches RETURN a message (never throw):
 *     a tool-handler throw is fatal to the whole turn, so the failure
 *     must travel as the tool's output string for the model to read and
 *     recover in-turn.
 *   - `buildTransferRoster` — which agents a turn ADVERTISES as transfer
 *     targets (system-prompt enumeration + the runtime allowlist).
 *     Advertisability is narrower than resolvability: `_default` stays
 *     dispatchable for headless runs and persisted sessions, but each
 *     context is offered exactly one "default" — `''` interactively,
 *     `_default` headlessly.
 *
 * Keeping these pure means the five documented Genkit sharp edges
 * (stream-abort mirrored on both channels; tool-arg `INVALID_ARGUMENT`;
 * `output:{schema}` -> `INTERNAL` masking; lazy session persist;
 * tool-handler throws aborting the turn) are pinned by a `node --test`
 * truth table rather than by reviewer vigilance.
 */

import type { Part, ResumeOptions } from "genkit/beta"

import type { AiProvider, BotChatEffort } from "./domain.js"

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
  { prompt: string | Part[] } | { resume: ResumeOptions } | { kind: "continue" }

/**
 * Map a {@link TurnDelivery} to the `chat.sendStream(...)` input — a bare string
 * for a plain prompt, or a structural `{ message }` / `{ resume }` object.
 * (Structural, not the framework's `AgentInput` which isn't publicly exported;
 * `runChatTurn` casts the result to `chat.sendStream`'s parameter type.)
 *   - `{ prompt: string }`  → the bare string (the framework wraps it).
 *   - `{ prompt: Part[] }`  → a `{ message }` carrying the multimodal user turn.
 *   - `{ resume }`          → `{ resume }` (folds the HITL answer back in).
 *   - `{ kind: "continue" }`→ `{}` — generate on the (truncated) thread alone,
 *     which is precisely what the transfer second turn wants.
 */
export function deliveryToAgentInput(delivery: TurnDelivery) {
  if ("prompt" in delivery) {
    return typeof delivery.prompt === "string"
      ? delivery.prompt
      : { message: { role: "user", content: delivery.prompt } }
  }
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
// Transfer roster — what a turn ADVERTISES as transfer targets
// ===========================================================================

/**
 * The slice of an agent doc the roster decision needs. Structural on
 * purpose: `TeamAgentDoc` satisfies it directly, while tests build
 * candidates without dragging in Firestore `Timestamp`s (`archivedAt`
 * is only ever truthiness-checked here).
 */
export interface TransferCandidate {
  id: string
  name: string
  description: string
  enabled?: boolean
  /** Truthy = archived. `Timestamp | null` on the real doc. */
  archivedAt?: unknown
}

/** One enumerated target: id for the tool call, name+description for the prompt. */
export interface TransferRosterEntry {
  id: string
  name: string
  description: string
}

/**
 * Build the "you can transfer to…" roster for the current turn. Each
 * entry is passed to `buildAgentSystemPrompt` (to enumerate targets in
 * the system prompt) and projected to ids for
 * `actionContext.availableTransferAgentIds` (the runtime allowlist
 * `resolveTransferOutcome` checks).
 *
 * This decides **advertisability**, which is deliberately narrower than
 * **resolvability**: `availableAgents` (the `candidates` here) keeps
 * every dispatchable persona — including `_default` and archived
 * agents — so `resolveActiveAgent` can keep serving sessions that
 * already reference them (deprecate-but-run). The roster only controls
 * what the model is OFFERED:
 *
 *   - Disabled agents are gated out of dispatch anyway — transferring
 *     to one would just bounce back to default; not useful to
 *     advertise. Archived agents still dispatch for chats that ALREADY
 *     reference them, but the whole point of archive-as-deprecate is to
 *     discourage new selections — so they aren't advertised either.
 *   - The active agent is excluded — transfer-to-self is a no-op the
 *     model shouldn't be tempted into (and used to crash the turn; see
 *     `resolveTransferOutcome`).
 *   - **Exactly one "default" per context.** The Default agent
 *     (`defaultAgentId`, `_default`) is an automation persona whose
 *     prompt assumes an unattended run ("there is no human to ask") and
 *     which the chat composer's picker can't represent (it models
 *     default as `null`). The synthetic `""` sentinel is the opposite:
 *     it clears `activeAgentId` back to the team's base persona — an
 *     interactive concept. Advertising both (as interactive turns did
 *     until 2026-06-10) gave the model two near-synonymous defaults and
 *     let it move a live chat onto the headless persona. So: user
 *     principals are offered `""` (when an agent is active to come back
 *     FROM), agent principals are offered `_default` — never both.
 *
 * The `""` entry's id flows through `normalizeActiveAgentIdForStorage`
 * to a `null` activeAgentId on the session doc. Its label/description
 * are hardcoded English because the directive lives in the server-side
 * system prompt, not user-facing i18n. It's skipped when the Default
 * agent is itself active — transferring "back to default" from the
 * Default persona would be a self-handoff.
 *
 * Returns `[]` when nothing is advertisable; the caller then withholds
 * the `transferToAgent` tool entirely and the system prompt emits the
 * "you are the only agent" guard instead.
 */
export function buildTransferRoster(args: {
  candidates: ReadonlyArray<TransferCandidate>
  /** Active agent's id, or `null` when the team-default persona drives. */
  activeAgentId: string | null
  /** `"user"` = interactive chat; `"agent"` = headless workflow run. */
  principalKind: "user" | "agent"
  /** The Default agent's reserved id (`DEFAULT_AGENT_ID`, `"_default"`). */
  defaultAgentId: string
}): TransferRosterEntry[] {
  const { candidates, activeAgentId, principalKind, defaultAgentId } = args
  const roster: TransferRosterEntry[] = []
  for (const candidate of candidates) {
    if (candidate.enabled === false) continue
    if (candidate.archivedAt) continue
    if (activeAgentId !== null && candidate.id === activeAgentId) continue
    if (candidate.id === defaultAgentId && principalKind === "user") continue
    roster.push({
      id: candidate.id,
      name: candidate.name,
      description: candidate.description,
    })
  }
  if (
    principalKind === "user" &&
    activeAgentId !== null &&
    activeAgentId !== defaultAgentId
  ) {
    roster.push({
      id: "",
      name: "Default Assistant",
      description: "The team's default persona — broad-purpose helper.",
    })
  }
  return roster
}

// ===========================================================================
// Transfer target validation
// ===========================================================================

/**
 * Outcome of validating a `transferToAgent` call against the turn's
 * allowlist. `transfer` means commit the handoff; `rejected` carries the
 * string the tool must RETURN as its output.
 *
 * Why return-not-throw is load-bearing: Genkit's tool runner
 * (`resolve-tool-requests.ts`) catches only `ToolInterruptError` — any
 * other handler throw propagates and aborts the entire generate turn.
 * The original handler threw `HttpsError("invalid-argument")` on a bad
 * target, believing Genkit would surface it to the model as a tool
 * error; instead the whole `sendBotMessage` callable failed and the
 * client saw `Unknown transfer target "_code"` plus an unhandled
 * promise rejection, with the user's message rolled back. Returning the
 * rejection as the tool's output keeps the turn alive: the model reads
 * it and picks a valid id or just answers.
 */
export type TransferOutcome =
  { kind: "transfer"; agentId: string } | { kind: "rejected"; message: string }

/**
 * Render a transfer-target id for model-facing messages. The empty
 * string is the "back to team default" sentinel — spelled out so the
 * model understands `''` is a deliberate, passable value rather than a
 * formatting accident.
 */
function formatTransferAgentId(id: string): string {
  return id === "" ? "'' (team default)" : `"${id}"`
}

/**
 * Decide what a `transferToAgent({ agentId })` call should do given the
 * turn's allowlist (`availableTransferAgentIds` on the action context)
 * and the currently active agent.
 *
 * Decision order is load-bearing:
 *
 *   1. **Allowlist hit → transfer.** The allowlist is the single
 *      authority; even a (theoretically unreachable) self-entry is
 *      honored rather than second-guessed here.
 *   2. **Requested id IS the active agent → "already active" rejection.**
 *      The roster excludes the active agent by construction, and the
 *      persona prompt doesn't state its own id — so a model asked for
 *      "the code helper" while BEING the code helper guesses `_code`
 *      from the sibling naming pattern and lands here (the 2026-06-10
 *      production incident). The wording tells it to just answer.
 *   3. **Anything else → unknown-target rejection** with the full
 *      roster and an explicit "or continue without transferring" steer,
 *      so the model can retry without guessing.
 */
export function resolveTransferOutcome(args: {
  requestedAgentId: string
  availableAgentIds: ReadonlyArray<string>
  activeAgentId?: string
}): TransferOutcome {
  const { requestedAgentId, availableAgentIds, activeAgentId } = args
  if (availableAgentIds.includes(requestedAgentId)) {
    return { kind: "transfer", agentId: requestedAgentId }
  }
  const available =
    availableAgentIds.length === 0
      ? "(no other agents available)"
      : availableAgentIds.map(formatTransferAgentId).join(", ")
  if (activeAgentId !== undefined && requestedAgentId === activeAgentId) {
    return {
      kind: "rejected",
      message:
        `Transfer skipped: ${formatTransferAgentId(requestedAgentId)} is ` +
        "the currently active agent — you are already handling this " +
        "conversation, so answer the user directly. Available transfer " +
        `targets: ${available}.`,
    }
  }
  return {
    kind: "rejected",
    message:
      `Transfer failed: unknown target ${formatTransferAgentId(requestedAgentId)}. ` +
      `Available ids: ${available}. Pick one of these ids exactly as ` +
      "written, or continue the conversation without transferring.",
  }
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

/**
 * Claude 4.7+ removed `temperature`/`top_p`/`top_k` from the API entirely —
 * sending any of them is a 400 regardless of thinking state. 4.6-family
 * models still accept them.
 * ponytail: matches the catalog's opus-4-8; extend when a 4.7+/5-family
 * wire-name lands in BOT_AGENT_MODELS.
 */
const ANTHROPIC_SAMPLING_REMOVED_RE = /^claude-opus-4-[78]/

/**
 * Whether a wire-name accepts the canonical per-turn effort level:
 *   - Claude 4.6+ (Opus/Sonnet): `output_config.effort` — GA. Excludes
 *     Haiku 4.5, which rejects the parameter.
 *   - Gemini 3.x: `thinkingConfig.thinkingLevel` (2.5 only has token
 *     budgets, and none are in the catalog).
 * OpenAI gpt-5.1 takes `reasoning_effort` at the API level, but
 * @genkit-ai/compat-oai 1.40 has no config key for it on OpenAI models
 * (only xAI's grok-mini line) — flip it on here when the plugin ships one.
 * deepseek-reasoner reasons unconditionally; grok-3 (non-mini) has no knob.
 */
export function modelSupportsEffort(
  provider: AiProvider,
  name: string
): boolean {
  if (provider === "anthropic")
    return /^claude-(opus|sonnet)-4-[6-9]/.test(name)
  if (provider === "google") return /^gemini-3/.test(name)
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
 * baking in the per-provider thinking + effort mapping so every callsite
 * gets it identically:
 *
 *   - Gemini (2.5+/3): `thinkingConfig.includeThoughts` alongside sampling;
 *     an `effort` pick adds `thinkingConfig.thinkingLevel` (Gemini 3's
 *     reasoning-depth knob, independent of whether thoughts are surfaced).
 *   - Claude (4.6+): adaptive thinking (`thinking.adaptive`) with
 *     `display: "summarized"` so reasoning is surfaced — the fixed
 *     `budgetTokens` shape is deprecated on 4.6 and a hard 400 on 4.7+.
 *     Adaptive spends thinking inside `max_tokens`, so the old budget is
 *     kept as headroom on top of the answer allotment. An `effort` pick
 *     maps to the GA `effort` level. Claude 4.7+ also removed
 *     temperature/top_p/top_k API-wide (400 if sent), so those models get
 *     only the token ceiling.
 *   - OpenAI / xAI / DeepSeek: sampling only (see `modelSupportsEffort`
 *     for why no effort mapping yet).
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
  /** Model wire-name — gates `modelSupportsThinking` / `modelSupportsEffort`. */
  model: string
  sampling: TurnSampling
  /** The agent's `thinking` flag; thinking only applies if the model supports it. */
  thinkingEnabled: boolean
  /**
   * Per-turn reasoning-effort level picked in the composer. `null`/absent
   * means provider default; silently dropped for models without a knob so
   * a stale client pick can never fail a turn.
   */
  effort?: BotChatEffort | null
  temperatureCap?: number
}): Record<string, unknown> {
  const sampling: TurnSampling = { ...opts.sampling }
  if (opts.temperatureCap !== undefined && sampling.temperature !== undefined) {
    sampling.temperature = Math.min(sampling.temperature, opts.temperatureCap)
  }

  const thinkingOn = opts.thinkingEnabled && modelSupportsThinking(opts.model)
  const effort =
    opts.effort && modelSupportsEffort(opts.provider, opts.model)
      ? opts.effort
      : undefined

  if (opts.provider === "google") {
    const thinkingConfig: Record<string, unknown> = {
      ...(thinkingOn ? { includeThoughts: true } : {}),
      ...(effort ? { thinkingLevel: effort.toUpperCase() } : {}),
    }
    return Object.keys(thinkingConfig).length > 0
      ? { ...sampling, thinkingConfig }
      : { ...sampling }
  }

  if (opts.provider === "anthropic") {
    const base: Record<string, unknown> = ANTHROPIC_SAMPLING_REMOVED_RE.test(
      opts.model
    )
      ? sampling.maxOutputTokens !== undefined
        ? { maxOutputTokens: sampling.maxOutputTokens }
        : {}
      : { ...sampling }
    if (effort) base.effort = effort
    if (thinkingOn) {
      return {
        ...base,
        maxOutputTokens:
          (sampling.maxOutputTokens ?? 0) + ANTHROPIC_THINKING_BUDGET_TOKENS,
        apiVersion: "beta",
        thinking: { adaptive: true, display: "summarized" },
      }
    }
    return base
  }

  // OpenAI / xAI / DeepSeek (and any future provider): sampling only —
  // neither a thinking toggle nor an effort knob maps here yet (see
  // `modelSupportsEffort`). Kept total so the function never falls through.
  return { ...sampling }
}
