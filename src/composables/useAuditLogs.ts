import { useCurrentTeamRole } from "@/composables/useCurrentTeamRole"
import { usePaginatedLogs } from "@/composables/usePaginatedLogs"
import { useTeamUsage } from "@/composables/useTeamUsage"
import { firestore } from "@/modules/firebase"
import { useAuthStore } from "@/stores/authStore"
import {
  Timestamp,
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
  // Plan retention (shared table). The daily server sweep deletes older
  // rows; this cutoff hides them at once, so a downgrade never shows logs
  // the plan no longer keeps. Same (teamId, timestamp desc) index.
  const { auditLogCutoff, auditLogRetentionDays, canExportAuditLogs } =
    useTeamUsage()

  const buildQuery = (cursor?: QueryDocumentSnapshot | null): Query | null => {
    if (!currentTeamId.value) return null

    const cutoff = auditLogCutoff.value
    let q: Query = query(
      collection(firestore, "logs"),
      where("teamId", "==", currentTeamId.value),
      ...(cutoff ? [where("timestamp", ">=", Timestamp.fromDate(cutoff))] : []),
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
    watchSources: [currentTeamId, canViewLogs, auditLogCutoff],
  })

  return {
    logs,
    loading,
    error,
    hasMore,
    canViewLogs,
    fetchLogs,
    auditLogRetentionDays,
    canExportAuditLogs,
  }
}
