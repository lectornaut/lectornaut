import { useCurrentTeamRole } from "@/composables/useCurrentTeamRole"
import { usePaginatedLogs } from "@/composables/usePaginatedLogs"
import { firestore } from "@/modules/firebase"
import { useAuthStore } from "@/stores/authStore"
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

const PAGE_SIZE = 50

export function useAuditLogs() {
  const { currentTeamId } = storeToRefs(useAuthStore())
  const { canViewLogs } = useCurrentTeamRole(currentTeamId)

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
