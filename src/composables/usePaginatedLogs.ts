import type { ILogEntry } from "@/types"
import {
  getDocs,
  type Query,
  type QueryDocumentSnapshot,
} from "firebase/firestore"
import { ref, watch, type WatchSource } from "vue"

interface UsePaginatedLogsOptions {
  pageSize: number
  source: string
  errorMessage: string
  canFetch: () => boolean
  buildQuery: (cursor?: QueryDocumentSnapshot | null) => Query | null
  watchSources: WatchSource<unknown>[]
  immediate?: boolean
}

/**
 * Shared paginated logs loader used by activity/audit log views.
 * Handles reset, pagination, stale-request protection, and error state.
 */
export function usePaginatedLogs(options: UsePaginatedLogsOptions) {
  const logs = ref<ILogEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const hasMore = ref(true)
  const lastDoc = ref<QueryDocumentSnapshot | null>(null)
  let latestRequestId = 0

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

  const hydrateLogs = (snapshot: Awaited<ReturnType<typeof getDocs>>) =>
    snapshot.docs.map((doc) => {
      const data = doc.data() as ILogEntry
      return {
        ...data,
        id: data.id ?? doc.id,
      }
    })

  const fetchLogs = async (reset = false) => {
    if (!options.canFetch()) {
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

      const q = options.buildQuery(reset ? null : lastDoc.value)
      if (!q) {
        resetState()
        return
      }

      const snapshot = await getDocs(q)
      if (requestId !== latestRequestId) return

      const items = hydrateLogs(snapshot)
      logs.value = reset ? items : [...logs.value, ...items]
      lastDoc.value = snapshot.docs[snapshot.docs.length - 1] ?? lastDoc.value

      if (snapshot.size < options.pageSize) {
        hasMore.value = false
      }
    } catch (err) {
      if (requestId !== latestRequestId) return

      console.error(`[${options.source}] Failed to fetch logs:`, err)
      error.value = options.errorMessage
    } finally {
      if (requestId === latestRequestId) {
        loading.value = false
      }
    }
  }

  watch(
    options.watchSources,
    () => {
      if (!options.canFetch()) {
        cancelPendingRequests()
        resetState()
        return
      }
      void fetchLogs(true)
    },
    { immediate: options.immediate ?? true }
  )

  return {
    logs,
    loading,
    error,
    hasMore,
    fetchLogs,
    resetState,
    cancelPendingRequests,
  }
}
