/**
 * `runStructuredGeneration` — the one-shot seam for "shape B": a single,
 * session-less, tool-less generation that decodes the model's reply against
 * an `output` schema.
 *
 * Before this seam, six near-identical ~15-line blocks each re-derived
 * `resolveModel(...)` + a clamped sampling/`thinking`-by-provider config +
 * `use: aiMiddlewares()` + the same `output ?? (miss)` decode guard. That
 * spread the four documented Genkit sharp edges across every callsite. This
 * centralizes them so each guard applies once, structurally:
 *
 *   - **output-schema → INTERNAL masking.** `ai.generate({ output: { schema } })`
 *     validates the model's reply *after* generation; a required field the
 *     model omits throws `INVALID_ARGUMENT`, which a callable surfaces as an
 *     opaque `INTERNAL`. Callers keep their schemas `.partial()` and normalize
 *     in the handler; this seam returns the decoded object or `undefined`
 *     (never throws on a soft decode-miss), and the caller defaults.
 *   - **provider-aware sampling/thinking** is delegated to
 *     `buildTurnConfig` (shared with the streaming chat turn), so the clamp
 *     (`temperatureCap`) and the Anthropic `maxTokens > budget` rule live in
 *     exactly one place.
 *
 * Two invocation shapes, one seam:
 *   - inline `ai.generate` — the seam owns the call; caller passes
 *     `system?` + `prompt` + the `output` schema (botCompare, the three
 *     config generators).
 *   - dotprompt — a compiled prompt that owns its own messages + output
 *     schema; caller passes the `dotprompt` handle + its `input`
 *     (botSummarize). The seam still owns the resolved `{ model, config, use }`.
 *
 * Deliberately NOT migrated here (they are not structured generations, so
 * folding them in would be a false seam): the prompt-template custom tool and
 * the web-search tool both run free-form `ai.generate` with NO `output`
 * schema and NO middleware — web search additionally pins `googleAI.model()`
 * with a provider-specific `googleSearch` config. They stay in their own
 * wrappers.
 */

import type { Part, z } from "genkit/beta"

import { buildTurnConfig, type TurnSampling } from "./botTurn.js"
import { ai, getModelProvider, resolveModel } from "./genkitClient.js"
import { aiMiddlewares, type TurnUsage } from "./genkitMiddleware.js"

/** The resolved per-call invocation context shared by both shapes. */
interface ResolvedGeneration {
  model: ReturnType<typeof resolveModel>
  config: Record<string, unknown>
  use: ReturnType<typeof aiMiddlewares>
}

/**
 * A compiled dotprompt, reduced to the slice the seam calls: invoke with the
 * template `input` + the resolved `{ model, config, use }` and read `.output`.
 * Structural (not Genkit's generic `ExecutablePrompt`) so a specifically-typed
 * prompt handle — e.g. `ai.prompt<InputZod, OutputZod>(name)` — assigns here
 * without generic-variance friction; the caller casts the `.output` to its own
 * type, exactly as it did before this seam.
 */
interface StructuredDotprompt {
  (input: never, opts: ResolvedGeneration): Promise<{ output?: unknown }>
}

interface StructuredGenBase {
  /** Model wire-name — resolved + provider-dispatched inside. */
  model: string
  /** Sampling knobs; the caller computes any fixed/floored values. */
  sampling: TurnSampling
  /** Upper bound applied to temperature (summary/compare hug the source). */
  temperatureCap?: number
  /** Enable provider thinking when the model supports it. Defaults to false. */
  thinkingEnabled?: boolean
  /**
   * Per-run token accounting (Workflows). Omit to skip the metering middleware
   * layer entirely — matching the bare `aiMiddlewares()` the migrated callers
   * used. Passed straight through to `aiMiddlewares({ onUsage })`.
   */
  onUsage?: (usage: TurnUsage) => void
}

/** Inline `ai.generate` shape — the seam owns the generate call. */
interface StructuredGenInline<
  S extends z.ZodTypeAny,
> extends StructuredGenBase {
  system?: string | Part[]
  prompt: string | Part[]
  /** The `.partial()` output schema — see the module note on INTERNAL masking. */
  output: S
}

/** Dotprompt shape — the compiled prompt owns its messages + output schema. */
interface StructuredGenDotprompt extends StructuredGenBase {
  dotprompt: StructuredDotprompt
  /** Template input vars for the dotprompt. */
  input: unknown
}

function resolveGeneration(spec: StructuredGenBase): ResolvedGeneration {
  return {
    model: resolveModel(spec.model),
    config: buildTurnConfig({
      provider: getModelProvider(spec.model),
      model: spec.model,
      sampling: spec.sampling,
      thinkingEnabled: spec.thinkingEnabled ?? false,
      temperatureCap: spec.temperatureCap,
    }),
    // `onUsage: undefined` skips the metering layer (see `aiMiddlewares`), so
    // a caller that omits it behaves exactly like the old bare `aiMiddlewares()`.
    use: aiMiddlewares({ onUsage: spec.onUsage }),
  }
}

export async function runStructuredGeneration<S extends z.ZodTypeAny>(
  spec: StructuredGenInline<S>
): Promise<z.infer<S> | undefined>
export async function runStructuredGeneration(
  spec: StructuredGenDotprompt
): Promise<unknown>
export async function runStructuredGeneration(
  spec: StructuredGenInline<z.ZodTypeAny> | StructuredGenDotprompt
): Promise<unknown> {
  const resolved = resolveGeneration(spec)

  if ("dotprompt" in spec) {
    // The dotprompt owns its messages + output schema; we only hand it the
    // resolved model/config/middleware. Input is cast to the prompt's own
    // input type at this single boundary.
    const response = await spec.dotprompt(spec.input as never, resolved)
    return response.output ?? undefined
  }

  const response = await ai.generate({
    model: resolved.model,
    ...(spec.system !== undefined ? { system: spec.system } : {}),
    prompt: spec.prompt,
    output: { schema: spec.output },
    config: resolved.config,
    use: resolved.use,
  })
  return response.output ?? undefined
}
