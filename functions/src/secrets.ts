import { defineSecret } from "firebase-functions/params"

export const postmarkApiKey = defineSecret("POSTMARK_API_KEY")
export const geminiApiKey = defineSecret("GEMINI_API_KEY")
export const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY")
export const openaiApiKey = defineSecret("OPENAI_API_KEY")
export const appCheckExchangeSharedSecret = defineSecret(
  "APPCHECK_EXCHANGE_SHARED_SECRET"
)
export const appCheckAllowedAppId = defineSecret("APPCHECK_ALLOWED_APP_ID")
export const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY")
export const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET")
