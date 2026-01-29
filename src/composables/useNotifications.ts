import { firestore as db, functions } from "@/modules/firebase"
import { type INotification, type INotificationStatus } from "@/types"
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
import { computed, onUnmounted, ref, watch } from "vue"
import { useCurrentUser } from "vuefire"

export function useNotifications() {
  const user = useCurrentUser()
  const notifications = ref<INotification[]>([])
  const isLoading = ref(false)
  const limitCount = ref(20)

  let unsubscribe: (() => void) | null = null

  const unreadCount = computed(
    () => notifications.value.filter((n) => n.read === false).length
  )

  const inboxUnreadCount = computed(
    () =>
      notifications.value.filter(
        (n) => n.read === false && n.status === "inbox"
      ).length
  )

  const savedUnreadCount = computed(
    () =>
      notifications.value.filter(
        (n) => n.read === false && n.status === "saved"
      ).length
  )

  const doneUnreadCount = computed(
    () =>
      notifications.value.filter((n) => n.read === false && n.status === "done")
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

  const markAsInbox = async (notificationId: string) => {
    if (!user.value) return
    // Optimistic update
    const index = notifications.value.findIndex((n) => n.id === notificationId)
    if (index !== -1 && notifications.value[index]) {
      notifications.value[index].status = "inbox"
    }

    try {
      await updateDoc(
        doc(db, `users/${user.value!.uid}/notifications`, notificationId),
        {
          status: "inbox",
        }
      )
    } catch (e) {
      console.error("Failed to mark as inbox", e)
    }
  }

  const markAllRead = async (status?: INotificationStatus) => {
    // Optimistic
    notifications.value.forEach((n) => {
      if (n.read === false) {
        if (!status || n.status === status) {
          n.read = true
        }
      }
    })

    try {
      const fn = httpsCallable(functions, "markAllNotificationsRead")
      await fn({ status })
    } catch (e) {
      console.error("Failed to mark all read", e)
    }
  }

  const markAllDone = async (status?: INotificationStatus) => {
    // Optimistic
    notifications.value.forEach((n) => {
      if (n.status !== "done") {
        if (!status || n.status === status) {
          n.status = "done"
        }
      }
    })

    try {
      const fn = httpsCallable(functions, "markAllNotificationsDone")
      await fn({ status })
    } catch (e) {
      console.error("Failed to mark all done", e)
    }
  }

  const markAllSaved = async (status?: INotificationStatus) => {
    // Optimistic
    notifications.value.forEach((n) => {
      if (n.status !== "saved") {
        if (!status || n.status === status) {
          n.status = "saved"
        }
      }
    })

    try {
      const fn = httpsCallable(functions, "markAllNotificationsSaved")
      await fn({ status })
    } catch (e) {
      console.error("Failed to mark all saved", e)
    }
  }

  const markAllInbox = async (status?: INotificationStatus) => {
    // Optimistic
    notifications.value.forEach((n) => {
      if (n.status !== "inbox") {
        if (!status || n.status === status) {
          n.status = "inbox"
        }
      }
    })

    try {
      const fn = httpsCallable(functions, "markAllNotificationsInbox")
      await fn({ status })
    } catch (e) {
      console.error("Failed to mark all inbox", e)
    }
  }

  const markAllUnread = async (status?: INotificationStatus) => {
    // Optimistic
    notifications.value.forEach((n) => {
      if (n.read === true) {
        if (!status || n.status === status) {
          n.read = false
        }
      }
    })

    try {
      const fn = httpsCallable(functions, "markAllNotificationsUnread")
      await fn({ status })
    } catch (e) {
      console.error("Failed to mark all unread", e)
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

  const deleteNotification = async (notificationId: string) => {
    if (!user.value) return
    // Optimistic update
    const index = notifications.value.findIndex((n) => n.id === notificationId)
    if (index !== -1) {
      notifications.value.splice(index, 1)
    }

    try {
      await deleteDoc(
        doc(db, `users/${user.value.uid}/notifications`, notificationId)
      )
    } catch (e) {
      console.error("Failed to delete notification", e)
    }
  }

  const deleteAllNotifications = async (status?: INotificationStatus) => {
    // Optimistic update
    if (status) {
      notifications.value = notifications.value.filter(
        (n) => n.status !== status
      )
    } else {
      notifications.value = []
    }

    try {
      const fn = httpsCallable(functions, "deleteAllNotifications")
      await fn({ status })
    } catch (e) {
      console.error("Failed to delete all notifications", e)
    }
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
