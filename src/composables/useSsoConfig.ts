import {
  configureSso,
  deleteSso,
  testSsoConnection,
  updateTeamApprovedDomains,
  updateTeamLoginMethods,
  type ConfigureSsoRequest,
  type TestSsoConnectionRequest,
} from "@/composables/useFunctions"
import { firestore } from "@/modules/firebase"
import type { ITeamSecurityConfig } from "@/types/sso"
import { defaultLoginMethods, defaultSsoConfig } from "@/types/sso"
import { doc } from "firebase/firestore"
import type { Ref } from "vue"
import { toast } from "vue-sonner"
import { useDocument } from "vuefire"

/**
 * Composable for managing team SSO configuration in admin settings.
 * Provides reactive Firestore binding and Cloud Function wrappers.
 */
export function useSsoConfig(teamId: Ref<string | null>) {
  const saving = ref(false)
  const deleting = ref(false)
  const testing = ref(false)
  const savingLoginMethods = ref(false)
  const savingApprovedDomains = ref(false)

  // Reactive Firestore binding to security config
  const securityDocRef = computed(() => {
    if (!teamId.value) return null
    return doc(firestore, `teams/${teamId.value}/settings/security`)
  })

  const { data: securityConfig, pending: loading } =
    useDocument<ITeamSecurityConfig>(securityDocRef)

  // Computed helpers
  const loginMethods = computed(
    () => securityConfig.value?.loginMethods ?? defaultLoginMethods
  )

  const ssoConfig = computed(
    () => securityConfig.value?.sso ?? defaultSsoConfig
  )

  const hasSso = computed(
    () => ssoConfig.value.enabled && Boolean(ssoConfig.value.providerId)
  )

  const approvedDomains = computed(
    () => securityConfig.value?.approvedDomains ?? []
  )

  // Save SSO configuration
  const saveSsoConfig = async (config: Omit<ConfigureSsoRequest, "teamId">) => {
    if (!teamId.value) return
    saving.value = true

    try {
      const { data } = await configureSso({
        teamId: teamId.value,
        ...config,
      })
      toast.success("SSO configuration saved")
      return data
    } catch (error) {
      console.error("[useSsoConfig] save error:", error)
      const message =
        error instanceof Error
          ? error.message
          : "Failed to save SSO configuration"
      toast.error(message)
    } finally {
      saving.value = false
    }
  }

  // Delete SSO configuration
  const deleteSsoConfig = async () => {
    if (!teamId.value) return
    deleting.value = true

    try {
      await deleteSso({ teamId: teamId.value })
      toast.success("SSO configuration removed")
    } catch (error) {
      console.error("[useSsoConfig] delete error:", error)
      toast.error("Failed to remove SSO configuration")
    } finally {
      deleting.value = false
    }
  }

  // Test SSO connection
  const testConnection = async (
    config: Omit<TestSsoConnectionRequest, "teamId">
  ) => {
    if (!teamId.value) return { valid: false, error: "No team selected" }
    testing.value = true

    try {
      const { data } = await testSsoConnection({
        teamId: teamId.value,
        ...config,
      })
      if (data.valid) {
        toast.success("SSO connection is valid")
      } else {
        toast.error(data.error ?? "SSO connection test failed")
      }
      return data
    } catch (error) {
      console.error("[useSsoConfig] test error:", error)
      toast.error("Failed to test SSO connection")
      return { valid: false, error: "Test request failed" }
    } finally {
      testing.value = false
    }
  }

  // Save login methods
  const saveLoginMethods = async (methods: {
    emailPassword: boolean
    magicLink: boolean
    google: boolean
    microsoft: boolean
    apple: boolean
    sso: boolean
  }) => {
    if (!teamId.value) return
    savingLoginMethods.value = true

    try {
      await updateTeamLoginMethods({
        teamId: teamId.value,
        loginMethods: methods,
      })
      toast.success("Authentication methods updated")
    } catch (error) {
      console.error("[useSsoConfig] saveLoginMethods error:", error)
      toast.error("Failed to update authentication methods")
    } finally {
      savingLoginMethods.value = false
    }
  }

  // Save approved domains
  const saveApprovedDomains = async (domains: string[]) => {
    if (!teamId.value) return
    savingApprovedDomains.value = true

    try {
      await updateTeamApprovedDomains({
        teamId: teamId.value,
        approvedDomains: domains,
      })
      toast.success("Approved domains updated")
    } catch (error) {
      console.error("[useSsoConfig] saveApprovedDomains error:", error)
      toast.error("Failed to update approved domains")
    } finally {
      savingApprovedDomains.value = false
    }
  }

  return {
    // State
    securityConfig,
    loginMethods,
    approvedDomains,
    ssoConfig,
    hasSso,
    loading,
    saving: readonly(saving),
    deleting: readonly(deleting),
    testing: readonly(testing),
    savingLoginMethods: readonly(savingLoginMethods),
    savingApprovedDomains: readonly(savingApprovedDomains),

    // Actions
    saveSsoConfig,
    deleteSsoConfig,
    testConnection,
    saveLoginMethods,
    saveApprovedDomains,
  }
}
