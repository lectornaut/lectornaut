import { isTauri } from "@/composables/usePlatform"
import { generateRandomString } from "@/helpers/utilities"
import { invoke } from "@tauri-apps/api/core"
import { CustomProvider, ReCaptchaEnterpriseProvider } from "firebase/app-check"
import { VueFireAppCheck } from "vuefire"

interface TauriAppCheckProof {
  appId: string
  timestampMs: number
  nonce: string
  signature: string
}

interface TauriAppCheckTokenResponse {
  token: string
  expireTimeMillis: number
}

const APP_CHECK_EXCHANGE_FUNCTION_NAME = "exchangeTauriAppCheckToken"
const DEFAULT_FUNCTIONS_REGION = "us-central1"

const getExchangeUrl = () => {
  const explicitUrl = import.meta.env.VITE_APPCHECK_EXCHANGE_URL?.trim()
  if (explicitUrl) return explicitUrl

  return `https://${DEFAULT_FUNCTIONS_REGION}-${import.meta.env.VITE_PROJECT_ID}.cloudfunctions.net/${APP_CHECK_EXCHANGE_FUNCTION_NAME}`
}

const createNonce = () => generateRandomString()

const createTauriProvider = () =>
  new CustomProvider({
    getToken: async () => {
      const proof = await invoke<TauriAppCheckProof>("build_app_check_proof", {
        nonce: createNonce(),
      })

      const response = await fetch(getExchangeUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(proof),
      })

      if (!response.ok) {
        let message = "Failed to fetch App Check token"
        try {
          const body = (await response.json()) as { error?: string }
          if (body.error) message = body.error
        } catch {
          // Keep default error message when body is not JSON.
        }
        throw new Error(message)
      }

      const body =
        (await response.json()) as Partial<TauriAppCheckTokenResponse>
      if (
        typeof body.token !== "string" ||
        typeof body.expireTimeMillis !== "number"
      ) {
        throw new Error("Invalid App Check token response")
      }

      return {
        token: body.token,
        expireTimeMillis: body.expireTimeMillis,
      }
    },
  })

export const createAppCheckModule = () => {
  const debug =
    import.meta.env.DEV && import.meta.env.VITE_APPCHECK_DEBUG_TOKEN
      ? import.meta.env.VITE_APPCHECK_DEBUG_TOKEN
      : import.meta.env.DEV

  return VueFireAppCheck({
    debug,
    provider: isTauri.value
      ? createTauriProvider()
      : new ReCaptchaEnterpriseProvider(
          import.meta.env.VITE_RECAPTCHA_ENTERPRISE_KEY
        ),
    isTokenAutoRefreshEnabled: true,
  })
}
