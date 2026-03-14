import { withToast } from "@/helpers/toast"
import { firestore as db, functions } from "@/modules/firebase"
import {
  type INotification,
  type INotificationStatus,
} from "@/types/notification"
import { mutateWithCoordinator } from "@/utils/firebase/firebase-mutation-coordinator"
import {
  cloneState,
  createPendingSet,
  mergeOptimisticCollection,
  withOptimisticBatchUpdate,
} from "@/utils/firebase/firebase-optimistic"
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore"
import { httpsCallable } from "firebase/functions"
import { computed, onUnmounted, ref, shallowRef, watch } from "vue"
import { useCurrentUser } from "vuefire"

const sortNotifications = (notifications: INotification[]) =>
  [...notifications].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
  )

const toNotification = (
  id: string,
  data: Record<string, unknown>
): INotification => ({
  id,
  ...(data as Omit<INotification, "id" | "createdAt">),
  createdAt:
    data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date(),
})

export function useNotifications() {
  const user = useCurrentUser()
  const firestoreNotifications = ref<INotification[]>([])
  const optimisticNotifications = ref<INotification[]>([])
  const pendingNotificationIds = shallowRef(createPendingSet())
  const isLoading = ref(false)
  const limitCount = ref(20)

  const notifications = computed(() =>
    mergeOptimisticCollection(
      firestoreNotifications.value,
      optimisticNotifications.value,
      pendingNotificationIds.value,
      {
        sort: (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime(),
      }
    )
  )

  let unsubscribe: (() => void) | null = null

  const unreadCounts = computed(() => {
    const counts = {
      all: 0,
      inbox: 0,
      saved: 0,
      done: 0,
    }

    notifications.value.forEach((notification) => {
      if (notification.read) return

      counts.all += 1
      counts[notification.status] += 1
    })

    return counts
  })

  const unreadCount = computed(() => unreadCounts.value.all)
  const inboxUnreadCount = computed(() => unreadCounts.value.inbox)
  const savedUnreadCount = computed(() => unreadCounts.value.saved)
  const doneUnreadCount = computed(() => unreadCounts.value.done)

  const setOptimisticNotifications = (next: INotification[]) => {
    optimisticNotifications.value = sortNotifications(next)
  }

  const getNotificationSnapshot = (notificationId: string) => {
    const notification = notifications.value.find(
      (item) => item.id === notificationId
    )
    if (!notification) return null

    return {
      id: notification.id,
      read: notification.read,
      status: notification.status,
    }
  }

  const getNotificationSnapshots = (status?: INotificationStatus) =>
    notifications.value
      .filter((notification) => !status || notification.status === status)
      .map((notification) => ({
        id: notification.id,
        read: notification.read,
        status: notification.status,
      }))

  const updateNotification = async (
    notificationId: string,
    updates: Partial<INotification>
  ) => {
    if (!user.value) return

    const previousOptimistic = cloneState(optimisticNotifications.value)

    await mutateWithCoordinator({
      id: notificationId,
      source: "notifications.update",
      pendingIds: pendingNotificationIds,
      applyLocal: () => {
        setOptimisticNotifications(
          cloneState(notifications.value).map((notification) =>
            notification.id === notificationId
              ? ({ ...notification, ...updates } as INotification)
              : notification
          )
        )
      },
      rollbackLocal: () => {
        optimisticNotifications.value = previousOptimistic
      },
      mutation: {
        source: "notifications.update",
        targetPath: doc(
          db,
          `users/${user.value.uid}/notifications`,
          notificationId
        ).path,
        type: "update",
        data: updates as Record<string, unknown>,
      },
    })
  }

  const performBatchAction = async (
    actionName: string,
    status: INotificationStatus | undefined,
    transform: (items: INotification[]) => INotification[]
  ) => {
    const targetIds = notifications.value
      .filter((notification) => !status || notification.status === status)
      .map((notification) => notification.id)

    if (targetIds.length === 0) return

    const previousOptimistic = cloneState(optimisticNotifications.value)

    await withOptimisticBatchUpdate(
      pendingNotificationIds,
      targetIds,
      () => {
        setOptimisticNotifications(transform(cloneState(notifications.value)))
      },
      () => {
        optimisticNotifications.value = previousOptimistic
      },
      async () => {
        const fn = httpsCallable(functions, actionName)
        await fn({ status })
      },
      {
        source: `notifications.batch.${actionName}`,
      }
    )
  }

  const restoreNotification = async (snapshot: {
    id: string
    read: boolean
    status: INotificationStatus
  }) => {
    await updateNotification(snapshot.id, {
      read: snapshot.read,
      status: snapshot.status,
    })
  }

  const restoreNotifications = async (
    snapshots: Array<{
      id: string
      read: boolean
      status: INotificationStatus
    }>
  ) => {
    await Promise.all(
      snapshots.map((snapshot) => restoreNotification(snapshot))
    )
  }

  const runNotificationActionWithToast = <T>(
    operation: () => Promise<T>,
    options: {
      success: string
      error: string
      onUndo?: () => Promise<void>
      undoSuccessMessage?: string
      undoErrorMessage?: string
    }
  ) =>
    withToast(operation, {
      success: options.success,
      error: options.error,
      onUndo: options.onUndo,
      undoSuccessMessage: options.undoSuccessMessage,
      undoErrorMessage: options.undoErrorMessage,
    })

  const updateNotificationWithToast = async (
    notificationId: string,
    updates: Partial<INotification>,
    options: {
      success: string
      error: string
      undoSuccessMessage?: string
      undoErrorMessage?: string
    }
  ) => {
    const snapshot = getNotificationSnapshot(notificationId)

    return runNotificationActionWithToast(
      () => updateNotification(notificationId, updates),
      {
        success: options.success,
        error: options.error,
        onUndo: snapshot ? () => restoreNotification(snapshot) : undefined,
        undoSuccessMessage:
          options.undoSuccessMessage ?? "Restored notification",
        undoErrorMessage:
          options.undoErrorMessage ?? "Failed to restore notification",
      }
    )
  }

  const performBatchActionWithToast = async (
    actionName: string,
    status: INotificationStatus | undefined,
    transform: (items: INotification[]) => INotification[],
    options: {
      success: string
      error: string
      undoSuccessMessage?: string
      undoErrorMessage?: string
    }
  ) => {
    const snapshots = getNotificationSnapshots(status)

    return runNotificationActionWithToast(
      () => performBatchAction(actionName, status, transform),
      {
        success: options.success,
        error: options.error,
        onUndo:
          snapshots.length > 0
            ? () => restoreNotifications(snapshots)
            : undefined,
        undoSuccessMessage:
          options.undoSuccessMessage ?? "Restored notifications",
        undoErrorMessage:
          options.undoErrorMessage ?? "Failed to restore notifications",
      }
    )
  }

  const deleteNotificationMutation = async (notificationId: string) => {
    if (!user.value) return

    const previousOptimistic = cloneState(optimisticNotifications.value)
    const previousFirestore = cloneState(firestoreNotifications.value)

    await withOptimisticBatchUpdate(
      pendingNotificationIds,
      [notificationId],
      () => {
        firestoreNotifications.value = firestoreNotifications.value.filter(
          (notification) => notification.id !== notificationId
        )
        setOptimisticNotifications(
          cloneState(notifications.value).filter(
            (notification) => notification.id !== notificationId
          )
        )
      },
      () => {
        optimisticNotifications.value = previousOptimistic
        firestoreNotifications.value = previousFirestore
      },
      async () => {
        const fn = httpsCallable(functions, "deleteNotification")
        await fn({ notificationId })
      },
      {
        source: "notifications.delete",
      }
    )
  }

  const deleteAllNotificationsMutation = async (
    status?: INotificationStatus
  ) => {
    const targetIds = notifications.value
      .filter((notification) => !status || notification.status === status)
      .map((notification) => notification.id)
    const targetIdSet = new Set(targetIds)

    if (targetIds.length === 0) return

    const previousOptimistic = cloneState(optimisticNotifications.value)
    const previousFirestore = cloneState(firestoreNotifications.value)

    await withOptimisticBatchUpdate(
      pendingNotificationIds,
      targetIds,
      () => {
        firestoreNotifications.value = firestoreNotifications.value.filter(
          (notification) => !targetIdSet.has(notification.id)
        )
        setOptimisticNotifications(
          cloneState(notifications.value).filter(
            (notification) => !targetIdSet.has(notification.id)
          )
        )
      },
      () => {
        optimisticNotifications.value = previousOptimistic
        firestoreNotifications.value = previousFirestore
      },
      async () => {
        const fn = httpsCallable(functions, "deleteAllNotifications")
        await fn({ status })
      },
      {
        source: "notifications.batch.deleteAllNotifications",
      }
    )
  }

  const setupListener = () => {
    if (unsubscribe) unsubscribe()

    if (!user.value) {
      firestoreNotifications.value = []
      optimisticNotifications.value = []
      pendingNotificationIds.value = createPendingSet()
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
        firestoreNotifications.value = snapshot.docs.map((snapshotDoc) =>
          toNotification(
            snapshotDoc.id,
            snapshotDoc.data() as Record<string, unknown>
          )
        )
        isLoading.value = false
      },
      (error) => {
        console.error("Error listening to notifications:", error)
        isLoading.value = false
      }
    )
  }

  watch([user, limitCount], () => setupListener(), { immediate: true })

  watch(firestoreNotifications, (data) => {
    if (pendingNotificationIds.value.size === 0) {
      optimisticNotifications.value = cloneState(data)
    }
  })

  onUnmounted(() => {
    if (unsubscribe) unsubscribe()
  })

  const loadMore = () => {
    limitCount.value += 20
  }

  const markAsRead = (id: string) =>
    updateNotificationWithToast(
      id,
      { read: true },
      {
        success: "Marked as read",
        error: "Failed to mark as read",
      }
    )

  const markAsUnread = (id: string) =>
    updateNotificationWithToast(
      id,
      { read: false },
      {
        success: "Marked as unread",
        error: "Failed to mark as unread",
      }
    )

  const markAsInbox = (id: string) =>
    updateNotificationWithToast(
      id,
      { status: "inbox" },
      {
        success: "Moved to inbox",
        error: "Failed to move to inbox",
      }
    )

  const markAsDone = (id: string) =>
    updateNotificationWithToast(
      id,
      { status: "done" },
      {
        success: "Marked as done",
        error: "Failed to mark as done",
      }
    )

  const markAsSaved = (id: string) =>
    updateNotificationWithToast(
      id,
      { status: "saved" },
      {
        success: "Saved notification",
        error: "Failed to save notification",
      }
    )

  const markAllRead = (status?: INotificationStatus) =>
    performBatchActionWithToast(
      "markAllNotificationsRead",
      status,
      (items) =>
        items.map((notification) =>
          !status || notification.status === status
            ? { ...notification, read: true }
            : notification
        ),
      {
        success: "Marked all as read",
        error: "Failed to mark all as read",
      }
    )

  const markAllUnread = (status?: INotificationStatus) =>
    performBatchActionWithToast(
      "markAllNotificationsUnread",
      status,
      (items) =>
        items.map((notification) =>
          !status || notification.status === status
            ? { ...notification, read: false }
            : notification
        ),
      {
        success: "Marked all as unread",
        error: "Failed to mark all as unread",
      }
    )

  const markAllDone = (status?: INotificationStatus) =>
    performBatchActionWithToast(
      "markAllNotificationsDone",
      status,
      (items) =>
        items.map((notification) =>
          !status || notification.status === status
            ? { ...notification, status: "done" }
            : notification
        ),
      {
        success: "Moved all to done",
        error: "Failed to move all to done",
      }
    )

  const markAllSaved = (status?: INotificationStatus) =>
    performBatchActionWithToast(
      "markAllNotificationsSaved",
      status,
      (items) =>
        items.map((notification) =>
          !status || notification.status === status
            ? { ...notification, status: "saved" }
            : notification
        ),
      {
        success: "Moved all to saved",
        error: "Failed to move all to saved",
      }
    )

  const markAllInbox = (status?: INotificationStatus) =>
    performBatchActionWithToast(
      "markAllNotificationsInbox",
      status,
      (items) =>
        items.map((notification) =>
          !status || notification.status === status
            ? { ...notification, status: "inbox" }
            : notification
        ),
      {
        success: "Moved all to inbox",
        error: "Failed to move all to inbox",
      }
    )

  const deleteNotification = (notificationId: string) =>
    runNotificationActionWithToast(
      () => deleteNotificationMutation(notificationId),
      {
        success: "Deleted notification",
        error: "Failed to delete notification",
      }
    )

  const deleteAllNotifications = (status?: INotificationStatus) =>
    runNotificationActionWithToast(
      () => deleteAllNotificationsMutation(status),
      {
        success: "Deleted notifications",
        error: "Failed to delete notifications",
      }
    )

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
