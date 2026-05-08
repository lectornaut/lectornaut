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

import { enableFirebaseTelemetry } from "@genkit-ai/firebase"
import { googleAI } from "@genkit-ai/google-genai"
import { genkit } from "genkit/beta"

enableFirebaseTelemetry()

/**
 * Genkit Initialization
 * Sets up Google AI model (Gemini) for server-side generation.
 * Imported from genkit/beta so chat sessions are available.
 * `defineFlow`, `generateStream`, etc. are identical to the stable API.
 */
export const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model("gemini-3-flash-preview"),
})
