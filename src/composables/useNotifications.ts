import { firestore as db, functions } from "@/modules/firebase"
import { type INotification, type INotificationStatus } from "@/types"
import {
  cloneState,
  createPendingSet,
  withOptimisticUpdate,
} from "@/utils/firebase-optimistic"
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  updateDoc,
} from "firebase/firestore"
import { httpsCallable } from "firebase/functions"
import { computed, onUnmounted, ref, shallowRef, watch } from "vue"
import { useCurrentUser } from "vuefire"

export function useNotifications() {
  const user = useCurrentUser()
  const firestoreNotifications = ref<INotification[]>([])
  const optimisticNotifications = ref<INotification[]>([])
  const pendingNotificationIds = shallowRef(createPendingSet())
  const isLoading = ref(false)
  const limitCount = ref(20)

  // Merged state
  const notifications = computed(() => {
    const pending = pendingNotificationIds.value
    if (pending.size === 0) return firestoreNotifications.value

    const result: INotification[] = []
    const firestoreData = firestoreNotifications.value

    firestoreData.forEach((n) => {
      // If notification is pending, check if it was updated or deleted
      if (n.id && pending.has(n.id)) {
        const optimistic = optimisticNotifications.value.find(
          (on) => on.id === n.id
        )
        // If found in optimistic, use that version (handles updates)
        if (optimistic) {
          result.push(optimistic)
        }
        // If NOT found in optimistic, it means it's pending deletion -> skip it
        return
      }
      result.push(n)
    })

    return result
  })

  let unsubscribe: (() => void) | null = null

  // derived state
  const unreadCount = computed(
    () => notifications.value.filter((n) => !n.read).length
  )

  const getUnreadCountByStatus = (status: INotificationStatus) =>
    computed(
      () =>
        notifications.value.filter((n) => !n.read && n.status === status).length
    )

  const inboxUnreadCount = getUnreadCountByStatus("inbox")
  const savedUnreadCount = getUnreadCountByStatus("saved")
  const doneUnreadCount = getUnreadCountByStatus("done")

  const updateNotification = async (
    notificationId: string,
    updates: Partial<INotification>
  ) => {
    if (!user.value) return

    const previousOptimistic = cloneState(optimisticNotifications.value)

    await withOptimisticUpdate(
      pendingNotificationIds.value,
      notificationId,
      () => {
        // Special case: if we have it in optimistic list, update it.
        // If not, we found it in firestore list, so add to optimistic.
        const existingIndex = optimisticNotifications.value.findIndex(
          (n) => n.id === notificationId
        )
        if (existingIndex !== -1) {
          optimisticNotifications.value[existingIndex] = {
            ...optimisticNotifications.value[existingIndex],
            ...updates,
          } as INotification
        } else {
          const fsIndex = firestoreNotifications.value.findIndex(
            (n) => n.id === notificationId
          )
          if (fsIndex !== -1) {
            optimisticNotifications.value = [
              ...optimisticNotifications.value,
              {
                ...firestoreNotifications.value[fsIndex],
                ...updates,
              } as INotification,
            ]
          }
        }
      },
      () => {
        optimisticNotifications.value = previousOptimistic
      },
      async () => {
        await updateDoc(
          doc(db, `users/${user.value!.uid}/notifications`, notificationId),
          updates
        )
      }
    )
  }

  // Private helper for batch actions
  const performBatchAction = async (
    actionName: string,
    status?: INotificationStatus,
    optimisticUpdate?: (n: INotification) => void
  ) => {
    if (optimisticUpdate) {
      notifications.value.forEach((n) => {
        if (!status || n.status === status) {
          optimisticUpdate(n)
        }
      })
    }

    try {
      const fn = httpsCallable(functions, actionName)
      await fn({ status })
    } catch (e) {
      console.error(`Failed to perform batch action ${actionName}`, e)
    }
  }

  const setupListener = () => {
    if (unsubscribe) unsubscribe()
    if (!user.value) {
      firestoreNotifications.value = []
      isLoading.value = false
      return
    }

    isLoading.value = true
    const q = query(
      collection(db, `users/${user.value.uid}/notifications`),
      orderBy("createdAt", "desc"),
      limit(limitCount.value)
    )

    unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        firestoreNotifications.value = snapshot.docs.map((doc) => {
          const data = doc.data()
          return {
            id: doc.id,
            ...data,
            createdAt:
              data.createdAt instanceof Timestamp
                ? data.createdAt.toDate()
                : new Date(),
          } as INotification
        })
        isLoading.value = false
      },
      (error) => {
        console.error("Error listening to notifications:", error)
        isLoading.value = false
      }
    )
  }

  // Watch for user changes or limit changes
  watch([user, limitCount], () => setupListener(), { immediate: true })

  // Sync optimistic state
  watch(firestoreNotifications, (data) => {
    if (data && pendingNotificationIds.value.size === 0) {
      optimisticNotifications.value = cloneState(data)
    }
  })

  onUnmounted(() => {
    if (unsubscribe) unsubscribe()
  })

  // Public Actions
  const loadMore = () => (limitCount.value += 20)

  const markAsRead = (id: string) => updateNotification(id, { read: true })
  const markAsUnread = (id: string) => updateNotification(id, { read: false })
  const markAsInbox = (id: string) =>
    updateNotification(id, { status: "inbox" })
  const markAsDone = (id: string) => updateNotification(id, { status: "done" })
  const markAsSaved = (id: string) =>
    updateNotification(id, { status: "saved" })

  const markAllRead = (status?: INotificationStatus) =>
    performBatchAction(
      "markAllNotificationsRead",
      status,
      (n) => (n.read = true)
    )

  const markAllUnread = (status?: INotificationStatus) =>
    performBatchAction(
      "markAllNotificationsUnread",
      status,
      (n) => (n.read = false)
    )

  const markAllDone = (status?: INotificationStatus) =>
    performBatchAction(
      "markAllNotificationsDone",
      status,
      (n) => (n.status = "done")
    )

  const markAllSaved = (status?: INotificationStatus) =>
    performBatchAction(
      "markAllNotificationsSaved",
      status,
      (n) => (n.status = "saved")
    )

  const markAllInbox = (status?: INotificationStatus) =>
    performBatchAction(
      "markAllNotificationsInbox",
      status,
      (n) => (n.status = "inbox")
    )

  const deleteNotification = async (notificationId: string) => {
    if (!user.value) return

    const previousOptimistic = cloneState(optimisticNotifications.value)

    await withOptimisticUpdate(
      pendingNotificationIds.value,
      notificationId,
      () => {
        // If it was optimistic, remove from optimistic
        optimisticNotifications.value = optimisticNotifications.value.filter(
          (n) => n.id !== notificationId
        )
        // Also ensure it's not "visible" in merged state if it was only in firestore
        // The merged logic needs to handle this.
      },
      () => {
        optimisticNotifications.value = previousOptimistic
      },
      async () => {
        await deleteDoc(
          doc(db, `users/${user.value!.uid}/notifications`, notificationId)
        )
      }
    )
  }

  const deleteAllNotifications = (status?: INotificationStatus) => {
    // For batch actions, we can't easily use withOptimisticUpdate per-ID without IDs.
    // However, we can update the firestoreNotifications locally if we want a "fake" optimistic felt.
    // But since performBatchAction has its own optimistic update helper, let's use that.
    performBatchAction("deleteAllNotifications", status)
  }

  return {
    notifications,
    isLoading,
    unreadCount,
    inboxUnreadCount,
    savedUnreadCount,
    doneUnreadCount,
    loadMore,
    markAsRead,
    markAsUnread,
    markAsInbox,
    markAsDone,
    markAsSaved,
    markAllRead,
    markAllUnread,
    markAllInbox,
    markAllSaved,
    markAllDone,
    deleteNotification,
    deleteAllNotifications,
  }
}
