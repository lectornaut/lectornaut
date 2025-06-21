import { enableFirebaseTelemetry } from "@genkit-ai/firebase"
import { googleAI } from "@genkit-ai/googleai"
import { hasClaim, onCallGenkit } from "firebase-functions/https"
import { defineSecret } from "firebase-functions/params"
import { genkit, z } from "genkit"

const apiKey = defineSecret("GEMINI_API_KEY")

enableFirebaseTelemetry()

const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model("gemini-2.5-flash"),
})

const generatePoemStreamingFlow = ai.defineFlow(
  {
    name: "generatePoem",
    inputSchema: z.string(),
    streamSchema: z.string(),
    outputSchema: z.string(),
  },
  async (subject: string, { sendChunk }) => {
    const { stream, response } = ai.generateStream(
      `Compose a poem about ${subject}.`
    )

    for await (const chunk of stream) {
      sendChunk(chunk.text)
    }

    const text = (await response).text

    return text
  }
)

export const generateFlow = onCallGenkit(
  {
    secrets: [apiKey],
    authPolicy: hasClaim("email_verified"),
    enforceAppCheck: true,
  },
  generatePoemStreamingFlow
)
