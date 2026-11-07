/**
 * Genkit model middleware — composable interceptors that wrap every
 * `ai.generate(...)` / `session.chat(...)` call. Genkit 1.x doesn't
 * register middleware globally; each call site opts in via
 * `use: [...]`, so every AI surface in this package (chat,
 * summarize-callable, summarize-tool) passes through `aiMiddlewares()`
 * to apply the same stack.
 *
 * The onion: `(req, next) => next(req).then(maybe-mutate)`. Each layer
 * sees the outbound request, awaits the inner layer (eventually the
 * model), and gets the response back. Layers further from the model
 * wrap layers closer to it.
 *
 * Two base layers, outermost first:
 *
 *   1. `loggingMiddleware` — structured `[ai:middleware]` log on every
 *      call, capturing correlationId, duration, message shape, and error
 *      status (NOT token usage — `enableFirebaseTelemetry()` owns those
 *      metrics). Complements `withInstrumentation` (which sits at the
 *      Cloud Function boundary, one layer further out).
 *
 *   2. `tokenBudgetMiddleware` — pre-call ceiling on serialized input
 *      bytes, mapped via a 4-bytes-per-token heuristic. Cheap, no
 *      tokenizer dep. Trips a `resource-exhausted` HttpsError before
 *      the provider sees the request, so a runaway context window
 *      can't burn unbounded quota.
 *
 * User-provided text is passed to the model unchanged: connected tools
 * need exact values such as email recipients. Redaction is applied
 * explicitly to recalled workspace prose via `redactText`, not to
 * conversation messages.
 */

import { fallback, retry } from "@genkit-ai/middleware"
import * as logger from "firebase-functions/logger"
import { HttpsError } from "firebase-functions/v2/https"
import { GenkitError } from "genkit"
import type {
  ModelMiddleware,
  ModelMiddlewareArgument,
  ModelMiddlewareWithOptions,
} from "genkit/model"
import { billableUsage } from "./botTurn.js"
import { generateId } from "./utilities.js"

type GenerateMiddlewareRef = ReturnType<typeof retry>

/**
 * Bytes-to-tokens approximation used by `tokenBudgetMiddleware`. Lower
 * values are stricter — they cause the gate to trip on smaller
 * payloads. The right value depends on what's in the conversation:
 *
 *   - English prose: ~4 bytes/token (BPE tokenizers exploit common
 *     word fragments).
 *   - JSON / code / Tiptap documents: ~3 bytes/token (punctuation,
 *     identifiers, and indentation tokenize less efficiently).
 *
 * This codebase's workspaces are dominated by `code` and `write` scope
 * nodes — code snippets and Tiptap-JSON-encoded write nodes — both
 * categories that fall on the JSON/code side. Using `4` lets prompts
 * sneak past the budget that, by token count, would exceed the
 * provider's context window or our intended safety ceiling. Using `3`
 * trips closer to reality for our actual workload, at the cost of
 * occasionally over-counting for prose-heavy turns (acceptable —
 * those just get an honest "context too large" error and can shed
 * attachments).
 *
 * Switch to a real tokenizer (`@anthropic-ai/tokenizer` or
 * provider-native) when the budget gate's accuracy matters more than
 * the few-microseconds-per-turn cost the conversion adds.
 */
const TOKEN_BYTES_PER_TOKEN = 3
const DEFAULT_MAX_INPUT_TOKENS = 200_000

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
const PHONE_RE = /\+?\d[\d\s\-().]{7,}\d/g

/**
 * Replace email + phone patterns inside a text fragment. Conservative
 * by design — false positives cost the model some signal but a leaked
 * customer email costs more.
 *
 * Exported so per-tool redaction sites (`searchWorkspaceNodes` snippet
 * cleanup, `summarizeNode` output cleanup) share the same regex pair.
 * Do not apply this to user messages: tools need exact contact details.
 *
 * The phone regex is intentionally not applied to tool outputs in
 * general — its permissiveness (matches any
 * digit-heavy string with dashes/spaces) would false-positive on
 * structured fields like timestamps, GUIDs, semver. Per-tool callers
 * are responsible for narrowing application to free-form text fields.
 */
export function redactText(input: string): string {
  return input
    .replace(EMAIL_RE, "[redacted-email]")
    .replace(PHONE_RE, "[redacted-phone]")
}

/**
 * `logger` doesn't accept the whole request blob (too large, often
 * carries the entire chat history). Pull out the shape we want in
 * Cloud Logging: roles + part kinds + char counts.
 */
function summarizeMessages(req: {
  messages?: Array<{ role?: string; content?: unknown[] }>
}) {
  const messages = req.messages ?? []
  let textChars = 0
  let toolReqs = 0
  let toolResps = 0
  let mediaParts = 0
  for (const msg of messages) {
    for (const part of msg.content ?? []) {
      if (!part || typeof part !== "object") continue
      const p = part as Record<string, unknown>
      if (typeof p.text === "string") textChars += p.text.length
      if (p.toolRequest) toolReqs++
      if (p.toolResponse) toolResps++
      if (p.media) mediaParts++
    }
  }
  return {
    messageCount: messages.length,
    textChars,
    toolReqs,
    toolResps,
    mediaParts,
  }
}

/**
 * Logging middleware — a structured `[ai:middleware]` line per model call
 * for ad-hoc debugging in Cloud Logging (correlationId, pass/fail, the
 * request's message shape, and on failure the error message).
 *
 * Deliberately does NOT log token usage: `enableFirebaseTelemetry()`
 * (wired up in `genkitClient.ts`) already emits authoritative
 * input/output/thinking token + latency metrics to Cloud Monitoring,
 * dimensioned by model and feature. Re-logging the same numbers here would
 * just be a second, lower-fidelity copy — so this layer sticks to the
 * qualitative context telemetry metrics don't carry (which call, what
 * shape, did it fail) and leaves usage/latency METRICS to telemetry.
 */
export const loggingMiddleware: ModelMiddleware = async (req, next) => {
  const correlationId = generateId()
  const startTime = Date.now()
  const summary = summarizeMessages(req)

  try {
    const resp = await next(req)
    logger.info("[ai:middleware]", {
      correlationId,
      ok: true,
      durationMs: Date.now() - startTime,
      ...summary,
    })
    return resp
  } catch (err) {
    logger.error("[ai:middleware]", {
      correlationId,
      ok: false,
      durationMs: Date.now() - startTime,
      ...summary,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

/**
 * Per-call factory: returns a middleware that pre-checks the serialized
 * request size before the provider is contacted. The byte-to-token
 * conversion is intentionally rough — exact token counting is
 * provider-specific and adds latency to every call. The goal is a
 * cheap safety net, not a precise meter.
 *
 * Trips at `>` not `>=` so a request exactly at the budget passes.
 */
export function tokenBudgetMiddleware(
  maxInputTokens: number = DEFAULT_MAX_INPUT_TOKENS
): ModelMiddleware {
  return async (req, next) => {
    const serialized = JSON.stringify(req.messages ?? [])
    const estimatedTokens = Math.ceil(serialized.length / TOKEN_BYTES_PER_TOKEN)
    if (estimatedTokens > maxInputTokens) {
      throw new HttpsError(
        "resource-exhausted",
        `Conversation context is too large (${estimatedTokens} tokens estimated, limit ${maxInputTokens}). Start a new chat or remove some context.`
      )
    }
    return next(req)
  }
}

/** Token counts a single model call reported (zeros when absent). */
export interface TurnUsage {
  inputTokens: number
  outputTokens: number
}

/**
 * Metering middleware — records the model response's token usage AFTER the
 * call resolves. Unlike the chat-flow return (which only carries `text` +
 * `messages`), the model-layer response DOES expose `usage`, so this is the
 * one place token counts are observable. Fires once per model call, so a
 * tool-chaining turn (multiple `generate` round-trips under one `sendStream`)
 * accumulates every round's usage.
 *
 * `onUsage` is invoked best-effort: it must not throw and must not block (the
 * recorder is expected to be fire-and-forget). A response with no usage (some
 * providers/fallback paths) is silently skipped.
 */
export function meteringMiddleware(
  onUsage: (usage: TurnUsage) => void
): ModelMiddleware {
  return async (req, next) => {
    const resp = await next(req)
    try {
      if (resp?.usage) onUsage(billableUsage(resp.usage))
    } catch {
      // Metering is best-effort — never let it disturb the turn.
    }
    return resp
  }
}

/**
 * Mid-stream failure guard (innermost). `retry` / `fallback` re-run the model
 * call, but chunks an attempt already streamed have reached the client — a
 * re-run would append a second copy. A failure after the first chunk is
 * re-thrown as status `UNKNOWN`, which neither retries nor falls back.
 */
export const streamedFailureGuard: ModelMiddlewareWithOptions = async (
  req,
  options,
  next
) => {
  const onChunk = options?.onChunk
  let streamed = false
  try {
    return await next(
      req,
      onChunk
        ? {
            ...options,
            onChunk: (chunk) => {
              streamed = true
              onChunk(chunk)
            },
          }
        : options
    )
  } catch (e) {
    if (!streamed) throw e
    throw new GenkitError({
      status: "UNKNOWN",
      // `.message` of a GenkitError already carries its "STATUS: " prefix.
      message: `Model failed mid-stream (${e instanceof Error ? e.message : String(e)})`,
      detail: e,
    })
  }
}

/**
 * Transient-error retry, short enough for the 90s turn deadline.
 * `RESOURCE_EXHAUSTED` (429) is left to `fallback`: retry honors the
 * provider's `retry-after` uncapped, which can sleep through the deadline.
 * ponytail: retry also re-tries non-GenkitError throws (Genkit's rule), so a
 * provider 400 surfaced as a plain Error costs ~2 short retries before failing.
 */
const transientRetry = () =>
  retry({
    maxRetries: 2,
    initialDelayMs: 500,
    maxDelayMs: 4_000,
    statuses: ["UNAVAILABLE", "DEADLINE_EXCEEDED", "ABORTED", "INTERNAL"],
  })

/**
 * The stack we apply to every AI call in this package. Order matters:
 * Genkit invokes the array left-to-right as outer-to-inner:
 *
 *   logging → token budget → metering → fallback → retry → guard → provider
 *
 * - The budget gate sits OUTSIDE retry so a deterministic over-budget
 *   rejection is never retried.
 * - Metering sits OUTSIDE fallback because `fallback` calls the fallback model
 *   directly (skipping every layer inside it), so only an outer layer sees its
 *   usage. ponytail: a fallback-served call is metered at the PRIMARY model's
 *   rates (the meter is bound to the turn's model); tokens still count toward
 *   the cap. Bind the meter per model if fallback traffic ever matters.
 * - Retry is inside fallback: a blip retries the primary first; a persistent
 *   failure (or 429) then switches provider.
 *
 * Message content is not rewritten. Per-call overrides can append entries.
 */
export function aiMiddlewares(
  opts: {
    maxInputTokens?: number
    /**
     * When provided, a metering layer joins the stack so it observes response
     * usage. Used by chat turns to feed per-team token accounting; omit for
     * surfaces that shouldn't meter.
     */
    onUsage?: (usage: TurnUsage) => void
    /**
     * Model to switch to when the primary fails with a fallback-able status
     * (see `resolveFallbackModel`). `config` replaces the request's config —
     * provider-specific thinking/sampling shapes don't transfer.
     */
    fallback?: { name: string; config?: unknown } | null
  } = {}
): (ModelMiddlewareArgument | GenerateMiddlewareRef)[] {
  return [
    loggingMiddleware,
    tokenBudgetMiddleware(opts.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS),
    ...(opts.onUsage ? [meteringMiddleware(opts.onUsage)] : []),
    ...(opts.fallback
      ? [fallback({ models: [opts.fallback], isolateConfig: true })]
      : []),
    transientRetry(),
    streamedFailureGuard,
  ]
}
