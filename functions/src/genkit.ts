import { onCallGenkit } from "firebase-functions/https"
import { z } from "genkit/beta"
import { ai } from "./genkitClient.js"
import { GENKIT_OPTS } from "./runtimeConfig.js"
import { geminiApiKey } from "./secrets.js"

const generatePoemStreamingFlow = ai.defineFlow(
  {
    name: "generatePoem",
    inputSchema: z.string(),
    streamSchema: z.string(),
    outputSchema: z.string(),
  },
  async (
    subject: string,
    { sendChunk }: { sendChunk: (chunk: string) => void }
  ) => {
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
    ...GENKIT_OPTS,
    secrets: [geminiApiKey],
    authPolicy: (auth) => !!auth?.token?.email_verified,
    enforceAppCheck: true,
  },
  generatePoemStreamingFlow
)
