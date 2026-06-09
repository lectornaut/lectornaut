import {
  deleteAllNotifications as deleteAllNotificationsFn,
  deleteNotification as deleteNotificationFn,
  markAllNotificationsDone,
  markAllNotificationsInbox,
  markAllNotificationsRead,
  markAllNotificationsSaved,
  markAllNotificationsUnread,
} from "@/composables/useFunctions"
import { setBadgeCount } from "@/composables/usePlatform"
import { withToast } from "@/helpers/toast"
import { firestore } from "@/modules/firebase"
import {
  type INotification,
  type INotificationStatus,
} from "@/types/notification"
import { useRunWrite } from "@/utils/firebase/firebase-mutation"
import {
  useInfiniteCollectionQuery,
  type InfiniteCollectionData,
} from "@/utils/firebase/firebase-query"
import { mutateUpdateDocument } from "@/utils/firebase/firebase-sync-engine"
import { useStorage } from "@vueuse/core"
import {
  collection,
  doc,
  limit,
  orderBy,
  query,
  startAfter,
  Timestamp,
} from "firebase/firestore"
import { computed, onUnmounted, watch } from "vue"
import { useCurrentUser } from "vuefire"

const toNotification = (
  id: string,
  data: Record<string, unknown>
): INotification => ({
  id,
  ...(data as Omit<INotification, "id" | "createdAt">),
  createdAt:
    data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date(),
})

/**
 * Page size for both the live listener (most-recent slice) and each
 * `loadMore()` fetch. 20 is small enough that the initial render is
 * fast and large enough that most users never need to paginate.
 */
const NOTIFICATIONS_PAGE_SIZE = 20

/** Newest-first — the order both tiers and the merged view present. */
const byNewestFirst = (left: INotification, right: INotification) =>
  right.createdAt.getTime() - left.createdAt.getTime()

type NotificationEntry = InfiniteCollectionData<INotification>

const mapEntryRows = (
  entry: NotificationEntry,
  map: (notification: INotification) => INotification
): NotificationEntry => ({
  head: entry.head.map(map),
  tail: entry.tail.map(map),
})

const filterEntryRows = (
  entry: NotificationEntry,
  keep: (notification: INotification) => boolean
): NotificationEntry => ({
  head: entry.head.filter(keep),
  tail: entry.tail.filter(keep),
})

export function useNotifications() {
  const user = useCurrentUser()
  const runWrite = useRunWrite("notifications")

  // Reads live in the TanStack cache as a single `{ head, tail }` entry: a live
  // first-page `onSnapshot` plus cursor-paginated older pages. Optimism flows
  // through the same `runWrite({ keys })` hold every other store uses — no
  // bespoke optimistic overlay or collection-merge. The user-switch teardown and
  // page-1-reset the old hand-rolled listener did are handled by the primitive.
  const feed = useInfiniteCollectionQuery<INotification>(() => {
    if (!user.value) return null
    const path = `users/${user.value.uid}/notifications`
    const base = collection(firestore, path)
    return {
      path,
      pageSize: NOTIFICATIONS_PAGE_SIZE,
      buildQuery: (after) =>
        after
          ? query(
              base,
              orderBy("createdAt", "desc"),
              startAfter(after),
              limit(NOTIFICATIONS_PAGE_SIZE)
            )
          : query(
              base,
              orderBy("createdAt", "desc"),
              limit(NOTIFICATIONS_PAGE_SIZE)
            ),
      toRow: toNotification,
      sort: byNewestFirst,
    }
  })

  const notifications = feed.data
  const isLoading = feed.isLoading
  const isLoadingMore = feed.isLoadingMore
  const hasMore = feed.hasMore
  const loadMore = feed.loadMore

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

    const notifRef = doc(
      firestore,
      `users/${user.value.uid}/notifications`,
      notificationId
    )
    const previous = feed.snapshot()

    await runWrite({
      keys: [feed.key.value],
      apply: () =>
        feed.update((entry) =>
          mapEntryRows(entry, (notification) =>
            notification.id === notificationId
              ? ({ ...notification, ...updates } as INotification)
              : notification
          )
        ),
      rollback: () => feed.update(() => previous),
      fn: () =>
        mutateUpdateDocument(notifRef, updates as Record<string, unknown>, {
          source: "notifications.update",
        }),
      source: "notifications.update",
    })
  }

  const performBatchAction = async (
    callable: typeof markAllNotificationsRead,
    source: string,
    status: INotificationStatus | undefined,
    transform: (items: INotification[]) => INotification[]
  ) => {
    const targetIds = notifications.value
      .filter((notification) => !status || notification.status === status)
      .map((notification) => notification.id)

    if (targetIds.length === 0) return

    const previous = feed.snapshot()

    await runWrite({
      keys: [feed.key.value],
      // `transform` is a per-row map, so applying it to each tier independently
      // matches applying it to the merged view.
      apply: () =>
        feed.update((entry) => ({
          head: transform(entry.head),
          tail: transform(entry.tail),
        })),
      rollback: () => feed.update(() => previous),
      fn: async () => {
        await callable({ status })
      },
      source: `notifications.batch.${source}`,
    })
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
    callable: typeof markAllNotificationsRead,
    source: string,
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
      () => performBatchAction(callable, source, status, transform),
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

    const previous = feed.snapshot()

    await runWrite({
      keys: [feed.key.value],
      // Filter from both tiers — the row may be in either (or both; see the
      // head-wins dedup contract in `mergeHeadTail`).
      apply: () =>
        feed.update((entry) =>
          filterEntryRows(
            entry,
            (notification) => notification.id !== notificationId
          )
        ),
      rollback: () => feed.update(() => previous),
      fn: async () => {
        await deleteNotificationFn({ notificationId })
      },
      source: "notifications.delete",
    })
  }

  const deleteAllNotificationsMutation = async (
    status?: INotificationStatus
  ) => {
    const targetIds = notifications.value
      .filter((notification) => !status || notification.status === status)
      .map((notification) => notification.id)
    const targetIdSet = new Set(targetIds)

    if (targetIds.length === 0) return

    const previous = feed.snapshot()

    await runWrite({
      keys: [feed.key.value],
      apply: () =>
        feed.update((entry) =>
          filterEntryRows(
            entry,
            (notification) => !targetIdSet.has(notification.id)
          )
        ),
      rollback: () => feed.update(() => previous),
      fn: async () => {
        await deleteAllNotificationsFn({ status })
      },
      source: "notifications.batch.deleteAllNotifications",
    })
  }

  // Dock/taskbar badge toggle. Read straight from its localStorage key
  // (shared with the preferences settings and main.ts) so this feed composable
  // doesn't depend on the settings store.
  const badgeCount = useStorage<boolean>("badgeCount", true)

  watch(
    [badgeCount, inboxUnreadCount],
    ([showBadge, count]) => void setBadgeCount(showBadge ? count : null),
    { immediate: true }
  )

  onUnmounted(() => {
    void setBadgeCount(null)
  })

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
      markAllNotificationsRead,
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
      markAllNotificationsUnread,
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
      markAllNotificationsDone,
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
      markAllNotificationsSaved,
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
      markAllNotificationsInbox,
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
    isLoadingMore,
    hasMore,
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
