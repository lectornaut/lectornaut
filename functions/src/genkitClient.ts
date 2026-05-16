/**
 * Genkit client singleton — exported only for in-package consumers.
 *
 * IMPORTANT: this module must NOT be re-exported from `index.ts`.
 * Firebase Functions' loader walks every top-level export to identify
 * Cloud Functions, and the Genkit `ai` instance has circular references
 * inside its registry that overflow the loader's stack walker.
 *
 * Cloud Function endpoints that use Genkit live in `bot.ts` (chat,
 * tool-calling, action context, and Human-in-the-Loop callables);
 * they import `ai` from this module.
 */

import { anthropic } from "@genkit-ai/anthropic"
import { openAI } from "@genkit-ai/compat-oai/openai"
import { enableFirebaseTelemetry } from "@genkit-ai/firebase"
import { googleAI } from "@genkit-ai/google-genai"
import { genkit } from "genkit/beta"

enableFirebaseTelemetry()

/**
 * Genkit Initialization
 *
 * Three model providers are registered:
 *   - googleAI()   — Gemini family (default chat model + workspace embeddings)
 *   - anthropic()  — Claude family (Opus, Sonnet, Haiku)
 *   - openAI()     — GPT family (gpt-4o, gpt-4-turbo, gpt-5, …)
 *
 * Plugins are registered lazily — they only read their respective
 * `*_API_KEY` env vars when a model is actually invoked. Registering all
 * three is therefore safe even on functions that bind only one secret;
 * callers must list the right secret(s) in their `secrets: [...]`
 * deploy options for the env var to exist at call time.
 *
 * Imported from genkit/beta so chat sessions are available.
 * `defineFlow`, `generateStream`, etc. are identical to the stable API.
 */
export const ai = genkit({
  plugins: [googleAI(), anthropic(), openAI()],
  model: googleAI.model("gemini-3-flash-preview"),
})

/**
 * Model-wire-name → provider dispatch.
 *
 * Bot agent config stores the model as a flat string (e.g. `claude-sonnet-4-5`
 * or `gpt-4o`). At chat time we map the string to the right plugin's
 * `model(...)` helper so the rest of the flow stays provider-agnostic.
 *
 * Prefix-based to avoid maintaining a per-model switch:
 *   - "gemini-*"             → googleAI
 *   - "claude-*"             → anthropic
 *   - "gpt-*", "o1-*", "o3-*"→ openAI
 *
 * Unknown prefixes throw — the per-team config schema validates against
 * a known allowlist (see `BOT_AGENT_MODELS` in `bot.ts`), so reaching
 * this fallback indicates either a server-side bug or an upgrade race
 * where the Firestore doc names a model the deployed code doesn't know
 * about. Returning the model reference (rather than a string) lets
 * callers pass the result straight to `session.chat({ model })`.
 */
export function resolveModel(name: string) {
  if (name.startsWith("gemini-")) return googleAI.model(name)
  if (name.startsWith("claude-")) return anthropic.model(name)
  if (
    name.startsWith("gpt-") ||
    name.startsWith("o1-") ||
    name.startsWith("o3-")
  ) {
    return openAI.model(name)
  }
  throw new Error(
    `Unknown bot model "${name}". Expected a gemini-/claude-/gpt-/o1-/o3- prefixed wire-name.`
  )
}
