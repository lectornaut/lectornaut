import { defineSecret } from "firebase-functions/params"

export const postmarkApiKey = defineSecret("POSTMARK_API_KEY")
export const geminiApiKey = defineSecret("GEMINI_API_KEY")
export const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY")
export const openaiApiKey = defineSecret("OPENAI_API_KEY")
export const xaiApiKey = defineSecret("XAI_API_KEY")
export const deepseekApiKey = defineSecret("DEEPSEEK_API_KEY")

// Bind on EVERY callable that resolves a team-selectable chat model: any of the
// five providers may be chosen, and `resolveModel` raises failed-precondition if
// the picked provider's secret isn't bound. One array so adding a provider is a
// single edit, not a sweep across every AI callsite. See genkitClient.ts.
export const aiProviderSecrets = [
  geminiApiKey,
  anthropicApiKey,
  openaiApiKey,
  xaiApiKey,
  deepseekApiKey,
]
export const appCheckExchangeSharedSecret = defineSecret(
  "APPCHECK_EXCHANGE_SHARED_SECRET"
)
export const appCheckAllowedAppId = defineSecret("APPCHECK_ALLOWED_APP_ID")
export const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY")
export const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET")
// Connections OAuth (docs/connections-feature.prompt.md). The client id is
// technically public (the SPA also ships it via VITE_GOOGLE_OAUTH_CLIENT_ID)
// but binding it as a secret keeps the functions config on one mechanism.
export const googleOauthClientId = defineSecret("GOOGLE_OAUTH_CLIENT_ID")
export const googleOauthClientSecret = defineSecret(
  "GOOGLE_OAUTH_CLIENT_SECRET"
)
export const githubOauthClientId = defineSecret("GITHUB_OAUTH_CLIENT_ID")
export const githubOauthClientSecret = defineSecret(
  "GITHUB_OAUTH_CLIENT_SECRET"
)

/**
 * Every connection provider's OAuth client secret pair — spread into the
 * `secrets: [...]` of EACH function that exchanges or refreshes a binding
 * token (a function only sees a secret it declares). Adding a provider means
 * extending this one list, not hunting every call site.
 */
export const CONNECTION_OAUTH_SECRETS = [
  googleOauthClientId,
  googleOauthClientSecret,
  githubOauthClientId,
  githubOauthClientSecret,
]
