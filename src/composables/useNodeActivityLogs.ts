import { usePaginatedLogs } from "@/composables/usePaginatedLogs"
import { firestore } from "@/modules/firebase"
import { useMembershipStore } from "@/stores/membershipStore"
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
import { computed, type Ref } from "vue"

const PAGE_SIZE = 10

interface useNodeActivityLogsOptions {
  teamId: Ref<string | null>
  workspaceId: Ref<string | null>
  documentId: Ref<string | null>
}

export function useNodeActivityLogs({
  teamId,
  workspaceId,
  documentId,
}: useNodeActivityLogsOptions) {
  const membershipStore = useMembershipStore()
  const { isOwner, isAdmin } = storeToRefs(membershipStore)

  const canViewLogs = computed(() => isOwner.value || isAdmin.value)

  const buildQuery = (cursor?: QueryDocumentSnapshot | null): Query | null => {
    if (!teamId.value || !workspaceId.value || !documentId.value) {
      return null
    }

    let q: Query = query(
      collection(firestore, "logs"),
      where("teamId", "==", teamId.value),
      where("workspaceId", "==", workspaceId.value),
      where("resource.type", "==", "content"),
      where("resource.id", "==", documentId.value),
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
    source: "useNodeActivityLogs",
    errorMessage: "Failed to load document history.",
    canFetch: () =>
      Boolean(
        canViewLogs.value &&
        teamId.value &&
        workspaceId.value &&
        documentId.value
      ),
    buildQuery,
    watchSources: [teamId, workspaceId, documentId, canViewLogs],
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
