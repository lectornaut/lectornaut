import { defineSecret } from "firebase-functions/params"

export const postmarkApiKey = defineSecret("POSTMARK_API_KEY")
export const geminiApiKey = defineSecret("GEMINI_API_KEY")
