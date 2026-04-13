/**
 * Phone number verification via reCAPTCHA.
 *
 * Firebase Auth defaults to reCAPTCHA Enterprise for phone verification. In
 * dev environments (and some production scenarios where Enterprise is
 * misconfigured), the Enterprise bootstrap fails. We force the legacy v2 path
 * by temporarily patching `auth._getRecaptchaConfig` — a private SDK method,
 * but the only known way to opt out of Enterprise at runtime.
 *
 * Alternatives to consider if upstream issues are resolved:
 *  - `auth.settings.appVerificationDisabledForTesting = true` + Firebase test
 *    phone numbers (requires Firebase Console setup)
 *  - `connectAuthEmulator(auth, ...)` (requires Auth emulator running locally)
 */
import type { Auth, PhoneInfoOptions } from "firebase/auth"
import { PhoneAuthProvider, RecaptchaVerifier } from "firebase/auth"

const LOCAL_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"])

const shouldPreferRecaptchaV2 = (): boolean => {
  if (typeof window === "undefined") return false
  return import.meta.env.DEV || LOCAL_HOSTS.has(window.location.hostname)
}

const isRecaptchaEnterpriseBootstrapError = (error: unknown): boolean => {
  if (
    error instanceof Error &&
    "code" in error &&
    (error as { code: string }).code === "auth/argument-error"
  ) {
    return true
  }
  const message = String(
    error instanceof Error ? error.message : error
  ).toLowerCase()
  return (
    message.includes("invalid site key") ||
    message.includes("no recaptcha enterprise script loaded") ||
    message.includes("recaptcha enterprise site key undefined")
  )
}

type AuthWithRecaptchaInternals = Auth & {
  _getRecaptchaConfig?: () => unknown
}

/**
 * Runs `action` with `auth._getRecaptchaConfig` temporarily reporting "no
 * Enterprise enforcement", forcing Firebase Auth down the v2 reCAPTCHA path.
 * Restores the original method in `finally` so this is safe to wrap around
 * any throwing operation.
 */
const withForcedRecaptchaV2 = async <T>(
  auth: Auth,
  action: () => Promise<T>
): Promise<T> => {
  const authInternals = auth as AuthWithRecaptchaInternals
  const originalGetRecaptchaConfig =
    authInternals._getRecaptchaConfig?.bind(authInternals)

  if (!originalGetRecaptchaConfig) {
    if (import.meta.env.DEV) {
      console.warn(
        "[phone-verification] auth._getRecaptchaConfig is missing — Firebase SDK internals may have changed. reCAPTCHA v2 fallback is unavailable."
      )
    }
    return action()
  }

  authInternals._getRecaptchaConfig = () => ({
    getProviderEnforcementState: () => null,
    isProviderEnabled: () => false,
  })

  try {
    return await action()
  } finally {
    authInternals._getRecaptchaConfig = originalGetRecaptchaConfig
  }
}

export const verifyPhoneNumberWithRecaptcha = async (
  auth: Auth,
  phoneOptions: PhoneInfoOptions,
  containerId: string
): Promise<string> => {
  const container = document.getElementById(containerId)
  if (!container) {
    throw new Error(`reCAPTCHA container "${containerId}" was not found`)
  }

  const phoneAuthProvider = new PhoneAuthProvider(auth)

  const runWithVerifier = async (): Promise<string> => {
    const mount = document.createElement("div")
    container.replaceChildren(mount)
    const verifier = new RecaptchaVerifier(auth, mount, { size: "invisible" })
    try {
      return await phoneAuthProvider.verifyPhoneNumber(phoneOptions, verifier)
    } finally {
      verifier.clear()
      container.replaceChildren()
    }
  }

  if (shouldPreferRecaptchaV2()) {
    return withForcedRecaptchaV2(auth, runWithVerifier)
  }

  try {
    return await runWithVerifier()
  } catch (error) {
    if (!isRecaptchaEnterpriseBootstrapError(error)) throw error
    return withForcedRecaptchaV2(auth, runWithVerifier)
  }
}
