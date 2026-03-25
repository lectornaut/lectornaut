import { resolveSsoProvider } from "@/composables/useFunctions"
import { signInWithSsoRedirect } from "@/modules/auth"
import { router } from "@/modules/router"
import type { ISsoResolveResult } from "@/types/sso"
import { toast } from "vue-sonner"

/**
 * Composable for SSO login flow on the enter page.
 * Handles email domain → SSO provider resolution and redirect initiation.
 */
export function useSsoLogin() {
  const resolving = ref(false)
  const ssoResult = ref<ISsoResolveResult | null>(null)
  const ssoError = ref<string | null>(null)

  /**
   * Resolve whether an email address requires SSO login.
   * Returns the SSO config if found.
   */
  const resolve = async (email: string): Promise<ISsoResolveResult> => {
    resolving.value = true
    ssoError.value = null
    ssoResult.value = null

    try {
      const { data } = await resolveSsoProvider({ email })
      ssoResult.value = data
      return data
    } catch (error) {
      console.error("[useSsoLogin] resolve error:", error)
      ssoError.value = "Could not check SSO configuration. Please try again."
      return { sso: false }
    } finally {
      resolving.value = false
    }
  }

  /**
   * Start the SSO sign-in redirect flow.
   * If enforced, navigates to /enter/sso; otherwise triggers redirect directly.
   */
  const startSsoSignIn = async (
    providerId: string,
    email?: string,
    enforced?: boolean
  ) => {
    if (enforced) {
      // Navigate to the dedicated SSO page which handles the redirect
      await router.push({
        path: "/enter/sso",
        query: {
          email,
          providerId,
          ...(router.currentRoute.value.query.redirect && {
            redirect: router.currentRoute.value.query.redirect as string,
          }),
        },
      })
    } else {
      // Trigger redirect directly from the current page
      try {
        await signInWithSsoRedirect(providerId, email)
      } catch (error) {
        console.error("[useSsoLogin] redirect error:", error)
        toast.error("Failed to start SSO sign-in. Please try again.")
      }
    }
  }

  const reset = () => {
    ssoResult.value = null
    ssoError.value = null
    resolving.value = false
  }

  return {
    resolving: readonly(resolving),
    ssoResult: readonly(ssoResult),
    ssoError: readonly(ssoError),
    resolve,
    startSsoSignIn,
    reset,
  }
}
