import { firestore as db, functions } from "@/modules/firebase"
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  updateDoc,
} from "firebase/firestore"
import { httpsCallable } from "firebase/functions"
import { computed, onUnmounted, ref, watch } from "vue"
import { useCurrentUser } from "vuefire"

export interface Notification {
  id: string
  type: "welcome" | "invitation"
  title: string
  description: string
  url: string
  status: "inbox" | "saved" | "done"
  read: boolean
  createdAt: Date
  source?: {
    entityType: string
    entityId: string
  }
}

export function useNotifications() {
  const user = useCurrentUser()
  const notifications = ref<Notification[]>([])
  const isLoading = ref(false)
  const limitCount = ref(20)

  let unsubscribe: (() => void) | null = null

  const unreadCount = computed(
    () =>
      notifications.value.filter((n) => n.read === false && n.status !== "done")
        .length
  )

  const setupListener = () => {
    if (unsubscribe) unsubscribe()
    if (!user.value) {
      notifications.value = []
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
        notifications.value = snapshot.docs.map((doc) => {
          const data = doc.data()
          return {
            id: doc.id,
            ...data,
            status: data.status,
            read: data.read,
            createdAt:
              data.createdAt instanceof Timestamp
                ? data.createdAt.toDate()
                : new Date(),
          } as Notification
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
  watch(
    [user, limitCount],
    () => {
      setupListener()
    },
    { immediate: true }
  )

  onUnmounted(() => {
    if (unsubscribe) unsubscribe()
  })

  const loadMore = () => {
    limitCount.value += 20
  }

  const markAsRead = async (notificationId: string) => {
    if (!user.value) return
    // Optimistic update
    const index = notifications.value.findIndex((n) => n.id === notificationId)
    if (index !== -1 && notifications.value[index]) {
      const notification = notifications.value[index]
      if (notification.read === false) {
        notification.read = true
      }
    }

    try {
      await updateDoc(
        doc(db, `users/${user.value!.uid}/notifications`, notificationId),
        {
          read: true,
        }
      )
    } catch (e) {
      console.error("Failed to mark as read", e)
      // Revert optimistic if needed, but snapshots usually fix consistency
    }
  }

  const markAsDone = async (notificationId: string) => {
    if (!user.value) return
    // Optimistic update
    const index = notifications.value.findIndex((n) => n.id === notificationId)
    if (index !== -1 && notifications.value[index]) {
      notifications.value[index].status = "done"
    }

    try {
      await updateDoc(
        doc(db, `users/${user.value!.uid}/notifications`, notificationId),
        {
          status: "done",
        }
      )
    } catch (e) {
      console.error("Failed to mark as done", e)
    }
  }

  const markAsSaved = async (notificationId: string) => {
    if (!user.value) return
    // Optimistic update
    const index = notifications.value.findIndex((n) => n.id === notificationId)
    if (index !== -1 && notifications.value[index]) {
      notifications.value[index].status = "saved"
    }

    try {
      await updateDoc(
        doc(db, `users/${user.value!.uid}/notifications`, notificationId),
        {
          status: "saved",
        }
      )
    } catch (e) {
      console.error("Failed to mark as saved", e)
    }
  }

  const markAllRead = async () => {
    // Optimistic
    notifications.value.forEach((n) => {
      if (n.read === false) n.read = true
    })

    try {
      const fn = httpsCallable(functions, "markAllNotificationsRead")
      await fn()
    } catch (e) {
      console.error("Failed to mark all read", e)
    }
  }

  const markAllDone = async () => {
    // Optimistic
    notifications.value.forEach((n) => {
      if (n.status !== "done") n.status = "done"
    })

    try {
      const fn = httpsCallable(functions, "markAllNotificationsDone")
      await fn()
    } catch (e) {
      console.error("Failed to mark all done", e)
    }
  }

  const markAllSaved = async () => {
    // Optimistic
    notifications.value.forEach((n) => {
      if (n.status !== "saved") n.status = "saved"
    })

    try {
      console.warn("markAllNotificationsSaved is not implemented on backend")
    } catch (e) {
      console.error("Failed to mark all saved", e)
    }
  }

  const markAsUnread = async (notificationId: string) => {
    if (!user.value) return
    // Optimistic update
    const index = notifications.value.findIndex((n) => n.id === notificationId)
    if (index !== -1 && notifications.value[index]) {
      const notification = notifications.value[index]
      if (notification.read === true) {
        notification.read = false
      }
    }

    try {
      await updateDoc(
        doc(db, `users/${user.value!.uid}/notifications`, notificationId),
        {
          read: false,
        }
      )
    } catch (e) {
      console.error("Failed to mark as unread", e)
    }
  }

  return {
    notifications,
    isLoading,
    unreadCount,
    loadMore,
    markAsRead,
    markAsUnread,
    markAsDone,
    markAsSaved,
    markAllRead,
    markAllDone,
    markAllSaved,
  }
}
