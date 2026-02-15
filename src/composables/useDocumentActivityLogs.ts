import { firestore } from "@/modules/firebase"
import { useMembershipStore } from "@/stores/membershipStore"
import type { ILogEntry } from "@/types"
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from "firebase/firestore"
import { storeToRefs } from "pinia"
import { computed, ref, watch, type Ref } from "vue"

const PAGE_SIZE = 10

interface UseDocumentActivityLogsOptions {
  teamId: Ref<string | null>
  workspaceId: Ref<string | null>
  documentId: Ref<string | null>
}

export function useDocumentActivityLogs({
  teamId,
  workspaceId,
  documentId,
}: UseDocumentActivityLogsOptions) {
  const membershipStore = useMembershipStore()
  const { isOwner, isAdmin } = storeToRefs(membershipStore)

  const logs = ref<ILogEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const hasMore = ref(true)
  const lastDoc = ref<QueryDocumentSnapshot | null>(null)
  let latestRequestId = 0

  const canViewLogs = computed(() => isOwner.value || isAdmin.value)

  const cancelPendingRequests = () => {
    latestRequestId += 1
    loading.value = false
  }

  const resetState = () => {
    logs.value = []
    error.value = null
    hasMore.value = true
    lastDoc.value = null
  }

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

  const hydrateLogs = (snapshot: QuerySnapshot) =>
    snapshot.docs.map((doc) => {
      const data = doc.data() as ILogEntry
      return {
        ...data,
        id: data.id ?? doc.id,
      }
    })

  const fetchLogs = async (reset = false) => {
    if (!canViewLogs.value) {
      cancelPendingRequests()
      resetState()
      return
    }

    if (loading.value && !reset) return

    if (reset) {
      cancelPendingRequests()
    }

    const requestId = ++latestRequestId

    loading.value = true
    error.value = null

    try {
      if (reset) {
        resetState()
      }

      if (!hasMore.value && !reset) {
        return
      }

      const q = buildQuery(reset ? null : lastDoc.value)
      if (!q) {
        resetState()
        return
      }

      const snapshot = await getDocs(q)
      if (requestId !== latestRequestId) return

      const items = hydrateLogs(snapshot)

      logs.value = reset ? items : [...logs.value, ...items]
      lastDoc.value = snapshot.docs[snapshot.docs.length - 1] ?? lastDoc.value

      if (snapshot.size < PAGE_SIZE) {
        hasMore.value = false
      }
    } catch (err) {
      if (requestId !== latestRequestId) return

      console.error("[useDocumentActivityLogs] Failed to fetch logs:", err)
      error.value = "Failed to load document history."
    } finally {
      if (requestId === latestRequestId) {
        loading.value = false
      }
    }
  }

  watch(
    [teamId, workspaceId, documentId, canViewLogs],
    ([nextTeamId, nextWorkspaceId, nextDocumentId, allowed]) => {
      if (!nextTeamId || !nextWorkspaceId || !nextDocumentId || !allowed) {
        cancelPendingRequests()
        resetState()
        return
      }

      fetchLogs(true)
    },
    { immediate: true }
  )

  return {
    logs,
    loading,
    error,
    hasMore,
    canViewLogs,
    fetchLogs,
  }
}
