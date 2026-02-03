import { firestore } from "@/modules/firebase"
import { useAuthStore } from "@/stores/authStore"
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
import { computed, ref, watch } from "vue"

const PAGE_SIZE = 50

export function useAuditLogs() {
  const authStore = useAuthStore()
  const membershipStore = useMembershipStore()
  const { currentTeamId } = storeToRefs(authStore)
  const { isOwner, isAdmin } = storeToRefs(membershipStore)

  const logs = ref<ILogEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const lastDoc = ref<QueryDocumentSnapshot | null>(null)
  const hasMore = ref(true)

  const canViewLogs = computed(() => isOwner.value || isAdmin.value)

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
      logs.value = []
      return
    }

    if (loading.value) return

    loading.value = true
    error.value = null

    try {
      if (reset) {
        lastDoc.value = null
        hasMore.value = true
        logs.value = []
      }

      if (!hasMore.value && !reset) {
        return
      }

      const q = buildQuery(reset ? null : lastDoc.value)
      if (!q) return

      const snapshot = await getDocs(q)
      const items = hydrateLogs(snapshot)

      logs.value = reset ? items : [...logs.value, ...items]
      lastDoc.value = snapshot.docs[snapshot.docs.length - 1] ?? lastDoc.value

      if (snapshot.size < PAGE_SIZE) {
        hasMore.value = false
      }
    } catch (err) {
      console.error("[useAuditLogs] Failed to fetch logs:", err)
      error.value = "Failed to load logs."
    } finally {
      loading.value = false
    }
  }

  watch([currentTeamId, canViewLogs], ([teamId, allowed]) => {
    if (!teamId || !allowed) {
      logs.value = []
      return
    }
    fetchLogs(true)
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
