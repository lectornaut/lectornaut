import { usePaginatedLogs } from "@/composables/usePaginatedLogs"
import { firestore } from "@/modules/firebase"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import { can, Capabilities } from "@/types/permissions"
import {
  collection,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type Query,
  type QueryDocumentSnapshot,
} from "firebase/firestore"
import { storeToRefs } from "pinia"
import { computed } from "vue"

const PAGE_SIZE = 50

export function useAuditLogs() {
  const authStore = useAuthStore()
  const membershipStore = useMembershipStore()
  const { currentTeamId, currentUser } = storeToRefs(authStore)
  const { memberships } = storeToRefs(membershipStore)

  const currentRole = computed(() => {
    if (!currentTeamId.value || !currentUser.value) return null
    return (
      memberships.value.find(
        (m) =>
          m.teamId === currentTeamId.value &&
          m.userId === currentUser.value?.uid
      )?.role ?? null
    )
  })

  const canViewLogs = computed(() =>
    can(currentUser.value, Capabilities.READ_AUDIT_LOGS, {
      scope: "team",
      teamRole: currentRole.value,
    })
  )

  const buildQuery = (cursor?: QueryDocumentSnapshot | null): Query | null => {
    if (!currentTeamId.value) return null

    let q: Query = query(
      collection(firestore, "logs"),
      where("teamId", "==", currentTeamId.value),
      orderBy("timestamp", "desc"),
      limit(PAGE_SIZE)
    )

    if (cursor) {
      q = query(q, startAfter(cursor))
    }

    return q
  }

  const { logs, loading, error, hasMore, fetchLogs } = usePaginatedLogs({
    pageSize: PAGE_SIZE,
    source: "useAuditLogs",
    errorMessage: "Failed to load logs.",
    canFetch: () => Boolean(currentTeamId.value && canViewLogs.value),
    buildQuery,
    watchSources: [currentTeamId, canViewLogs],
  })

  return {
    logs,
    loading,
    error,
    hasMore,
    canViewLogs,
    fetchLogs,
  }
}
