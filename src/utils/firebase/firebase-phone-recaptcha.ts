import type { Auth, PhoneInfoOptions, RecaptchaVerifier } from "firebase/auth"
import {
  RecaptchaVerifier as FirebaseRecaptchaVerifier,
  PhoneAuthProvider,
} from "firebase/auth"

type RecaptchaConfigOverride = {
  getProviderEnforcementState: (_provider: string) => null
  isProviderEnabled: (_provider: string) => false
}

type AuthWithRecaptchaInternals = Auth & {
  _getRecaptchaConfig?: () => unknown
}

const FORCE_RECAPTCHA_V2_CONFIG: RecaptchaConfigOverride = {
  getProviderEnforcementState: () => null,
  isProviderEnabled: () => false,
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"])

const shouldPreferRecaptchaV2 = () => {
  if (typeof window === "undefined") return false
  return import.meta.env.DEV || LOCAL_HOSTS.has(window.location.hostname)
}

const shouldRetryWithRecaptchaV2 = (error: unknown) => {
  if (
    error instanceof Error &&
    "code" in error &&
    (error as { code: string }).code === "auth/argument-error"
  ) {
    return true
  }

  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()

  return [
    "invalid site key",
    "no recaptcha enterprise script loaded",
    "recaptcha enterprise site key undefined",
  ].some((fragment) => lower.includes(fragment))
}

const createRecaptchaMount = (containerId: string) => {
  const container = document.getElementById(containerId)

  if (!container) {
    throw new Error(`reCAPTCHA container "${containerId}" was not found`)
  }

  const mount = document.createElement("div")
  container.replaceChildren(mount)

  return { container, mount }
}

const withRecaptchaVerifier = async <T>(
  auth: Auth,
  containerId: string,
  action: (verifier: RecaptchaVerifier) => Promise<T>
) => {
  const { container, mount } = createRecaptchaMount(containerId)
  const verifier = new FirebaseRecaptchaVerifier(auth, mount, {
    size: "invisible",
  })

  try {
    return await action(verifier)
  } finally {
    verifier.clear()
    container.replaceChildren()
  }
}

const withForcedRecaptchaV2 = async <T>(
  auth: Auth,
  action: () => Promise<T>
) => {
  const authWithInternals = auth as AuthWithRecaptchaInternals
  const originalGetRecaptchaConfig =
    authWithInternals._getRecaptchaConfig?.bind(authWithInternals)

  if (!originalGetRecaptchaConfig) {
    if (import.meta.env.DEV) {
      console.warn(
        "[recaptcha] auth._getRecaptchaConfig is missing — Firebase internals may have changed. " +
          "reCAPTCHA v2 fallback is unavailable."
      )
    }
    return action()
  }

  // Firebase Auth only falls back to reCAPTCHA v2 when phone Enterprise is
  // unavailable. For local/dev environments with a broken Enterprise site key,
  // temporarily forcing the provider config "off" lets the SDK take the stable
  // v2 path instead of crashing during Enterprise bootstrap.
  authWithInternals._getRecaptchaConfig = () => FORCE_RECAPTCHA_V2_CONFIG

  try {
    return await action()
  } finally {
    authWithInternals._getRecaptchaConfig = originalGetRecaptchaConfig
  }
}

export const verifyPhoneNumberWithRecaptcha = async (
  auth: Auth,
  phoneOptions: PhoneInfoOptions,
  containerId: string
) => {
  const phoneAuthProvider = new PhoneAuthProvider(auth)

  if (shouldPreferRecaptchaV2()) {
    return withForcedRecaptchaV2(auth, () =>
      withRecaptchaVerifier(auth, containerId, (verifier) =>
        phoneAuthProvider.verifyPhoneNumber(phoneOptions, verifier)
      )
    )
  }

  try {
    return await withRecaptchaVerifier(auth, containerId, (verifier) =>
      phoneAuthProvider.verifyPhoneNumber(phoneOptions, verifier)
    )
  } catch (error) {
    if (!shouldRetryWithRecaptchaV2(error)) {
      throw error
    }

    return withForcedRecaptchaV2(auth, () =>
      withRecaptchaVerifier(auth, containerId, (verifier) =>
        phoneAuthProvider.verifyPhoneNumber(phoneOptions, verifier)
      )
    )
  }
}
