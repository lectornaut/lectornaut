import { createActionRunner } from "@/composables/useActionRunner"
import {
  configureSso,
  deleteSso,
  testSsoConnection,
  updateTeamApprovedDomains,
  updateTeamLoginMethods,
  type ConfigureSsoRequest,
  type TestSsoConnectionRequest,
} from "@/composables/useFunctions"
import { useLoadingState } from "@/composables/useLoadingState"
import { firestore } from "@/modules/firebase"
import type { ITeamSecurityConfig } from "@/types/sso"
import { defaultLoginMethods, defaultSsoConfig } from "@/types/sso"
import { useDocumentQuery } from "@/utils/firebase/firebase-query"
import { doc, type DocumentReference } from "firebase/firestore"
import { toValue, type MaybeRefOrGetter } from "vue"

type SsoOperation =
  | "save"
  | "delete"
  | "test"
  | "loginMethods"
  | "approvedDomains"

/**
 * Composable for managing team SSO configuration in admin settings.
 * Provides reactive Firestore binding and Cloud Function wrappers.
 */
export function useSsoConfig(teamId: MaybeRefOrGetter<string | null>) {
  const loading = useLoadingState<SsoOperation>()
  const actions = createActionRunner(loading.withLoading)

  // Reactive Firestore binding to security config
  const securityDocRef = computed(() => {
    const id = toValue(teamId)
    if (!id) return null
    // This collection has no Zod converter; assert the row shape on the ref
    // (what the previous `useDocument<ITeamSecurityConfig>` did implicitly).
    return doc(
      firestore,
      `teams/${id}/settings/security`
    ) as DocumentReference<ITeamSecurityConfig>
  })

  const { data: securityConfig, isLoading: loadingConfig } =
    useDocumentQuery(securityDocRef)

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

  const requireTeamId = (): string => {
    const id = toValue(teamId)
    if (!id) throw new Error("No team selected")
    return id
  }

  // Save SSO configuration
  const saveSsoConfig = async (config: Omit<ConfigureSsoRequest, "teamId">) =>
    actions.run(
      "save",
      async () => {
        const id = requireTeamId()
        const { data } = await configureSso({ teamId: id, ...config })
        return data
      },
      {
        success: "SSO configuration saved",
        error: "Failed to save SSO configuration",
      }
    )

  // Delete SSO configuration
  const deleteSsoConfig = async () =>
    actions.run(
      "delete",
      async () => {
        const id = requireTeamId()
        await deleteSso({ teamId: id })
      },
      {
        success: "SSO configuration removed",
        error: "Failed to remove SSO configuration",
      }
    )

  // Test SSO connection
  const testConnection = async (
    config: Omit<TestSsoConnectionRequest, "teamId">
  ) =>
    actions.run(
      "test",
      async () => {
        const id = requireTeamId()
        const { data } = await testSsoConnection({ teamId: id, ...config })
        return data
      },
      {
        success: "SSO connection is valid",
        error: "Failed to test SSO connection",
      }
    )

  // Save login methods
  const saveLoginMethods = async (methods: {
    emailPassword: boolean
    magicLink: boolean
    google: boolean
    microsoft: boolean
    apple: boolean
    sso: boolean
  }) =>
    actions.run(
      "loginMethods",
      async () => {
        const id = requireTeamId()
        await updateTeamLoginMethods({ teamId: id, loginMethods: methods })
      },
      {
        success: "Authentication methods updated",
        error: "Failed to update authentication methods",
      }
    )

  // Save approved domains
  const saveApprovedDomains = async (domains: string[]) =>
    actions.run(
      "approvedDomains",
      async () => {
        const id = requireTeamId()
        await updateTeamApprovedDomains({
          teamId: id,
          approvedDomains: domains,
        })
      },
      {
        success: "Approved domains updated",
        error: "Failed to update approved domains",
      }
    )

  // Backward-compatible loading refs
  const saving = computed(() => loading.isLoading("save"))
  const deleting = computed(() => loading.isLoading("delete"))
  const testing = computed(() => loading.isLoading("test"))
  const savingLoginMethods = computed(() => loading.isLoading("loginMethods"))
  const savingApprovedDomains = computed(() =>
    loading.isLoading("approvedDomains")
  )

  return {
    // State
    securityConfig,
    loginMethods,
    approvedDomains,
    ssoConfig,
    hasSso,
    loading: loadingConfig,
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
