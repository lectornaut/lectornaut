import type { IConnection, IConnectionBinding } from "@/schemas/connections"
import { useAuthStore } from "@/stores/authStore"
import {
  getConnectionBindingRef,
  getConnectionsCollection,
} from "@/utils/firebase/firebase-helpers"
import {
  useCollectionQuery,
  useDocumentQuery,
  type CollectionQuerySource,
} from "@/utils/firebase/firebase-query"
import { getConnectionResourceProvider } from "@lectornaut/shared/connectionResources"
import { CONNECTION_PROVIDERS } from "@lectornaut/shared/domain"
import { storeToRefs } from "pinia"
import { computed } from "vue"

/** Lightweight status; own-account metadata listeners are opt-in, without OAuth setup. */
export function useConnectionStatus(includeAccountStatus = false) {
  const { currentTeamId, currentUser } = storeToRefs(useAuthStore())
  const query = useCollectionQuery<IConnection>(
    (): CollectionQuerySource | null => {
      const teamId = currentTeamId.value
      return teamId
        ? {
            query: getConnectionsCollection(teamId),
            path: `teams/${teamId}/connections`,
          }
        : null
    }
  )
  const connections = computed(() => query.data.value ?? [])
  const bindings = new Map(
    includeAccountStatus
      ? CONNECTION_PROVIDERS.map(
          (provider) =>
            [
              provider,
              useDocumentQuery<IConnectionBinding>(() =>
                currentTeamId.value &&
                currentUser.value?.uid &&
                connections.value.some((c) => c.provider === provider)
                  ? getConnectionBindingRef(
                      currentTeamId.value,
                      provider,
                      currentUser.value.uid
                    )
                  : null
              ),
            ] as const
        )
      : []
  )
  const providerFor = getConnectionResourceProvider
  const installed = (
    type: "agent" | "tool" | "workflow",
    key: string
  ): boolean =>
    connections.value.some((c) => c.provider === providerFor(type, key))
  const disabled = (
    type: "agent" | "tool" | "workflow",
    key: string
  ): boolean =>
    connections.value.some(
      (c) => c.provider === providerFor(type, key) && c.status === "disabled"
    )
  const accountStatus = (type: "agent" | "tool" | "workflow", key: string) => {
    const provider = providerFor(type, key)
    const binding = provider ? bindings.get(provider) : undefined
    if (!binding || binding.isLoading.value) return null
    if (binding.error.value) return "error"
    return binding.data.value?.status === "connected"
      ? null
      : binding.data.value?.status === "needs_reauth"
        ? "needs_reauth"
        : "not_connected"
  }
  return {
    installed,
    disabled,
    providerFor,
    accountStatus,
    isLoading: query.isLoading,
    error: query.error,
  }
}
