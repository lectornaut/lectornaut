import { defineSecret } from "firebase-functions/params"

export const postmarkApiKey = defineSecret("POSTMARK_API_KEY")
export const geminiApiKey = defineSecret("GEMINI_API_KEY")
export const appCheckExchangeSharedSecret = defineSecret(
  "APPCHECK_EXCHANGE_SHARED_SECRET"
)
export const appCheckAllowedAppId = defineSecret("APPCHECK_ALLOWED_APP_ID")
