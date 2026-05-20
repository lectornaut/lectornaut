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
import { HttpsError } from "firebase-functions/v2/https"
import { genkit } from "genkit/beta"
import path from "node:path"
import { fileURLToPath } from "node:url"

enableFirebaseTelemetry()

export type AiModelProvider = "google" | "anthropic" | "openai"

const providerSecretEnvKey: Record<AiModelProvider, string> = {
  google: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
}

const providerLabels: Record<AiModelProvider, string> = {
  google: "Google Gemini",
  anthropic: "Anthropic Claude",
  openai: "OpenAI",
}

function readSecret(provider: AiModelProvider): string | undefined {
  return process.env[providerSecretEnvKey[provider]]
}

/**
 * Genkit Initialization
 *
 * Plugins are registered conditionally on whether their provider secret
 * is present in `process.env`. Module-load is therefore side-effect-free
 * with respect to secrets, which matters for two paths:
 *
 *   1. Firebase's deploy-time source analyzer imports this module
 *      before any Secret Manager binding is injected. Throwing here
 *      would break `firebase deploy` unless the shell also exported the
 *      provider keys, so module-load must tolerate an empty env.
 *   2. At runtime in Cloud Run, the `secrets: [...]` binding declared
 *      on every AI callable populates `process.env` before this module
 *      is imported by the handler. All three secrets must still be
 *      listed on every AI callable so every team-selectable model
 *      resolves successfully.
 *
 * The real "is this provider usable?" gate is `resolveModel`, which
 * calls `assertAiModelProviderConfigured` and raises a clear
 * `failed-precondition` HttpsError if a binding is incomplete in
 * production. The runtime check is what enforces the policy; this
 * initializer just opens the door.
 *
 * This singleton intentionally has no default generation model. Every
 * generation surface must pass the team-selected model explicitly via
 * `resolveModel(agentConfig.model)`. That keeps a hardcoded fallback in
 * this module from silently overriding Settings -> Agents.
 *
 * Imported from genkit/beta so chat sessions are available.
 * `defineFlow`, `generateStream`, etc. are identical to the stable API.
 */
const googleKey = readSecret("google")
const anthropicKey = readSecret("anthropic")
const openaiKey = readSecret("openai")

/**
 * Dotprompt directory — resolved at module-load time relative to this
 * file's location. esbuild bundles `genkitClient.ts` into
 * `functions-deploy/index.js`, and `build.mjs` copies `.prompt`
 * files alongside it under `functions-deploy/prompts/`, so the
 * absolute path is `<bundle-dir>/prompts/`.
 *
 * Using an absolute path (rather than the default relative `prompts`)
 * is defensive: Cloud Run / Functions don't guarantee the process
 * `cwd` matches the bundle directory.
 *
 * Prompts under this directory are only those that are NOT user-
 * editable — internal engineering surfaces like the node summarizer.
 * User-configurable prompts (chat system prompts, per-mode suffixes)
 * live in Firestore under `teams/{teamId}/settings/agent` and are
 * fetched/composed at request time.
 */
const PROMPT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "prompts"
)

export const ai = genkit({
  promptDir: PROMPT_DIR,
  plugins: [
    ...(googleKey ? [googleAI({ apiKey: googleKey })] : []),
    ...(anthropicKey ? [anthropic({ apiKey: anthropicKey })] : []),
    ...(openaiKey ? [openAI({ apiKey: openaiKey })] : []),
  ],
})

export function getModelProvider(name: string): AiModelProvider {
  if (name.startsWith("gemini-")) return "google"
  if (name.startsWith("claude-")) return "anthropic"
  if (name.startsWith("gpt-")) return "openai"
  throw new HttpsError(
    "invalid-argument",
    `Unknown bot model "${name}". Expected a gemini-/claude-/gpt- prefixed wire-name.`
  )
}

export function isAiModelProviderConfigured(
  provider: AiModelProvider
): boolean {
  return Boolean(process.env[providerSecretEnvKey[provider]])
}

export function assertAiModelProviderConfigured(
  provider: AiModelProvider
): void {
  if (isAiModelProviderConfigured(provider)) return

  throw new HttpsError(
    "failed-precondition",
    `${providerLabels[provider]} is enabled for this team, but the server is missing ${providerSecretEnvKey[provider]}. Configure the provider secret before enabling it.`
  )
}

/**
 * Model-wire-name → provider dispatch.
 *
 * Bot agent config stores the model as a flat string (e.g. `claude-sonnet-4-5`
 * or `gpt-4o`). At chat time we map the string to the right plugin's
 * `model(...)` helper so the rest of the flow stays provider-agnostic.
 *
 * Prefix-based to avoid maintaining a per-model switch:
 *   - "gemini-*" → googleAI
 *   - "claude-*" → anthropic
 *   - "gpt-*"    → openAI
 *
 * Unknown prefixes throw — the per-team config schema validates against
 * a known allowlist (see `BOT_AGENT_MODELS` in `bot.ts`), so reaching
 * this fallback indicates either a server-side bug or an upgrade race
 * where the Firestore doc names a model the deployed code doesn't know
 * about. Returning the model reference (rather than a string) lets
 * callers pass the result straight to `session.chat({ model })`.
 *
 * Note: if OpenAI reasoning models (o1/o3/…) are added to
 * `BOT_AGENT_MODELS`, extend the `gpt-` branch with the new prefixes.
 */
export function resolveModel(name: string) {
  const provider = getModelProvider(name)
  assertAiModelProviderConfigured(provider)

  if (provider === "google") return googleAI.model(name)
  if (provider === "anthropic") return anthropic.model(name)
  return openAI.model(name)
}
