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
 * Three layers, outermost first (innermost called first by reading the
 * array bottom-up):
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
 *   3. `redactionMiddleware` — scrubs email addresses and obvious
 *      phone numbers from inbound user text parts. System messages
 *      and tool outputs pass through untouched (they're internal,
 *      not user-pasted content).
 */

import * as logger from "firebase-functions/logger"
import { HttpsError } from "firebase-functions/v2/https"
import type { ModelMiddleware } from "genkit/model"

import { generateId } from "./utilities.js"

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
 * cleanup, `summarizeNode` output cleanup) can apply the same regex
 * set the user-turn middleware uses. Centralizing one regex pair means
 * a tighter (or looser) policy ships to every redaction site at once.
 *
 * The phone regex is intentionally not applied through the middleware
 * to tool outputs in general — its permissiveness (matches any
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

/**
 * Redaction middleware — scrubs PII patterns from inbound user-role
 * text parts. Touches neither system messages (engineer-authored) nor
 * tool responses (server-computed); only the user-typed surface area.
 *
 * Builds a new request rather than mutating in place — the inner
 * layers shouldn't observe a different `req` reference than the
 * outer layers do.
 */
export const redactionMiddleware: ModelMiddleware = async (req, next) => {
  const messages = req.messages ?? []
  const scrubbed = messages.map((msg) => {
    if (msg.role !== "user") return msg
    const content = (msg.content ?? []).map((part) => {
      if (!part || typeof part !== "object") return part
      const p = part as Record<string, unknown>
      if (typeof p.text !== "string") return part
      return { ...p, text: redactText(p.text) }
    })
    return { ...msg, content }
  })
  return next({ ...req, messages: scrubbed } as typeof req)
}

/**
 * The stack we apply to every AI call in this package. Order matters:
 * Genkit invokes the array left-to-right as outer-to-inner, so the
 * model sees `redact → budget → log → provider`. Reading it
 * top-down: log it before anything happens, then enforce the budget,
 * then scrub PII, then hand off to the model.
 *
 * Per-call overrides (e.g. a stricter budget for a constrained
 * surface) can append extra entries — Genkit composes them in
 * declared order.
 */
export function aiMiddlewares(
  opts: { maxInputTokens?: number } = {}
): ModelMiddleware[] {
  return [
    loggingMiddleware,
    tokenBudgetMiddleware(opts.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS),
    redactionMiddleware,
  ]
}
