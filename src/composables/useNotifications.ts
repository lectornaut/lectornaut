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
import { useSettingsStore } from "@/stores/settingsStore"
import {
  type INotification,
  type INotificationStatus,
} from "@/types/notification"
import {
  FirestoreErrorCodes,
  hasFirebaseErrorCode,
} from "@/utils/firebase/firebase-errors"
import {
  cloneState,
  createPendingSet,
  mergeOptimisticCollection,
  withOptimisticBatchUpdate,
} from "@/utils/firebase/firebase-optimistic"
import { mutateWithCoordinator } from "@/utils/firebase/firebase-sync-engine"
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  Timestamp,
  type QueryDocumentSnapshot,
} from "firebase/firestore"
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

/**
 * Page size for both the live listener (most-recent slice) and each
 * `loadMore()` fetch. 20 is small enough that the initial render is
 * fast and large enough that most users never need to paginate.
 */
const NOTIFICATIONS_PAGE_SIZE = 20

export function useNotifications() {
  const user = useCurrentUser()

  // Two-tier storage: the listener owns the most-recent slice
  // (so new arrivals appear without manual refresh), while older pages
  // are fetched on demand via `getDocs` + cursor. This replaces the
  // earlier "expanding limit" pattern, where each `loadMore()` tore
  // down the listener and re-fetched the entire window — costing
  // 20+40+60+... reads for what should be 20+20+20+...
  const livePageNotifications = ref<INotification[]>([])
  const olderPagesNotifications = ref<INotification[]>([])
  const optimisticNotifications = ref<INotification[]>([])
  const pendingNotificationIds = shallowRef(createPendingSet())
  const isLoading = ref(false)
  const isLoadingMore = ref(false)
  const hasMore = ref(true)

  // Cursor for the next `getDocs` page. `shallowRef` per the project
  // convention in CLAUDE.md — a plain `ref` would deep-proxy the
  // Firestore snapshot's internals and break `startAfter()` when the
  // SDK introspects the cursor (assertion 0xb815, IndexedDB clone
  // failures, etc.). Same discipline as `usePaginatedLogs`.
  const olderPagesCursor = shallowRef<QueryDocumentSnapshot | null>(null)

  /**
   * Merged view of live + older pages. Dedup by id handles the
   * boundary where a brand-new notification arrives at the top and
   * displaces the bottom-of-live row, which is now also represented
   * in `olderPagesNotifications` (the page-2 fetch had captured what
   * was then page 2, but a row that's since moved across the page
   * boundary appears in both). Live wins.
   */
  const firestoreNotifications = computed<INotification[]>(() => {
    const seen = new Set<string>()
    const merged: INotification[] = []
    for (const notification of livePageNotifications.value) {
      if (seen.has(notification.id)) continue
      seen.add(notification.id)
      merged.push(notification)
    }
    for (const notification of olderPagesNotifications.value) {
      if (seen.has(notification.id)) continue
      seen.add(notification.id)
      merged.push(notification)
    }
    return merged
  })

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
          firestore,
          `users/${user.value.uid}/notifications`,
          notificationId
        ).path,
        type: "update",
        data: updates as Record<string, unknown>,
      },
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
        await callable({ status })
      },
      {
        source: `notifications.batch.${source}`,
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

    const previousOptimistic = cloneState(optimisticNotifications.value)
    const previousLive = cloneState(livePageNotifications.value)
    const previousOlder = cloneState(olderPagesNotifications.value)

    await withOptimisticBatchUpdate(
      pendingNotificationIds,
      [notificationId],
      () => {
        // Filter from both tiers — the deleted notification might be
        // in either (or both — see the dedup contract in
        // `firestoreNotifications`).
        livePageNotifications.value = livePageNotifications.value.filter(
          (notification) => notification.id !== notificationId
        )
        olderPagesNotifications.value = olderPagesNotifications.value.filter(
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
        livePageNotifications.value = previousLive
        olderPagesNotifications.value = previousOlder
      },
      async () => {
        await deleteNotificationFn({ notificationId })
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
    const previousLive = cloneState(livePageNotifications.value)
    const previousOlder = cloneState(olderPagesNotifications.value)

    await withOptimisticBatchUpdate(
      pendingNotificationIds,
      targetIds,
      () => {
        livePageNotifications.value = livePageNotifications.value.filter(
          (notification) => !targetIdSet.has(notification.id)
        )
        olderPagesNotifications.value = olderPagesNotifications.value.filter(
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
        livePageNotifications.value = previousLive
        olderPagesNotifications.value = previousOlder
      },
      async () => {
        await deleteAllNotificationsFn({ status })
      },
      {
        source: "notifications.batch.deleteAllNotifications",
      }
    )
  }

  const setupListener = () => {
    if (unsubscribe) unsubscribe()

    if (!user.value) {
      livePageNotifications.value = []
      olderPagesNotifications.value = []
      optimisticNotifications.value = []
      pendingNotificationIds.value = createPendingSet()
      olderPagesCursor.value = null
      hasMore.value = true
      isLoading.value = false
      isLoadingMore.value = false
      return
    }

    // Reset older-pages state — a fresh subscription starts back at
    // page 1 only. `loadMore()` will re-populate older pages on
    // demand. This matters at user-switch time and on hot reloads.
    olderPagesNotifications.value = []
    olderPagesCursor.value = null
    hasMore.value = true
    isLoading.value = true

    const q = query(
      collection(firestore, `users/${user.value.uid}/notifications`),
      orderBy("createdAt", "desc"),
      limit(NOTIFICATIONS_PAGE_SIZE)
    )

    unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        livePageNotifications.value = snapshot.docs.map((snapshotDoc) =>
          toNotification(
            snapshotDoc.id,
            snapshotDoc.data() as Record<string, unknown>
          )
        )
        // If the live page is full, the next `loadMore()` should start
        // after the last doc. If it's short, there can't be more —
        // collapse the load-more affordance.
        if (snapshot.size === NOTIFICATIONS_PAGE_SIZE) {
          // Only set the cursor when older pages haven't been loaded
          // yet — once `loadMore()` has advanced past page 1, its
          // own cursor is further along, and live emissions
          // shouldn't rewind it.
          if (olderPagesNotifications.value.length === 0) {
            olderPagesCursor.value = snapshot.docs[snapshot.size - 1] ?? null
          }
        } else {
          olderPagesCursor.value = null
          hasMore.value = false
        }
        isLoading.value = false
      },
      (error) => {
        // Benign during sign-out / token rotation: the listener emits
        // one final permission-denied snapshot before the user watcher
        // tears it down. Real errors (signed-in user, bad rule, etc.)
        // still surface.
        if (
          !user.value &&
          hasFirebaseErrorCode(error, FirestoreErrorCodes.PERMISSION_DENIED)
        ) {
          isLoading.value = false
          return
        }
        console.error("Error listening to notifications:", error)
        isLoading.value = false
      }
    )
  }

  watch(user, () => setupListener(), { immediate: true })

  watch(firestoreNotifications, (data) => {
    if (pendingNotificationIds.value.size === 0) {
      optimisticNotifications.value = cloneState(data)
    }
  })

  onUnmounted(() => {
    if (unsubscribe) unsubscribe()
    void setBadgeCount(null)
  })

  const settingsStore = useSettingsStore()

  watch(
    [() => settingsStore.badgeCount, inboxUnreadCount],
    ([showBadge, count]) => void setBadgeCount(showBadge ? count : null),
    { immediate: true }
  )

  /**
   * Fetch the next page of older notifications via cursor-based
   * pagination. One-shot `getDocs` (not a listener) — older pages
   * are static history, only the live page needs to react to new
   * arrivals.
   *
   * No-ops on the leading edge (loading state still in flight, no
   * more pages, no user) so callers can wire it to a button without
   * extra guards.
   */
  const loadMore = async () => {
    if (!user.value) return
    if (isLoadingMore.value) return
    if (!hasMore.value) return
    const cursor = olderPagesCursor.value
    if (!cursor) return

    isLoadingMore.value = true
    try {
      const q = query(
        collection(firestore, `users/${user.value.uid}/notifications`),
        orderBy("createdAt", "desc"),
        startAfter(cursor),
        limit(NOTIFICATIONS_PAGE_SIZE)
      )
      const snapshot = await getDocs(q)
      const next = snapshot.docs.map((snapshotDoc) =>
        toNotification(
          snapshotDoc.id,
          snapshotDoc.data() as Record<string, unknown>
        )
      )
      olderPagesNotifications.value = [
        ...olderPagesNotifications.value,
        ...next,
      ]
      // Advance the cursor to the last doc of THIS page; if the page
      // was short, there's nothing left.
      if (snapshot.size < NOTIFICATIONS_PAGE_SIZE) {
        hasMore.value = false
        olderPagesCursor.value = null
      } else {
        olderPagesCursor.value = snapshot.docs[snapshot.size - 1] ?? null
      }
    } catch (error) {
      // Don't latch hasMore=false on transient errors — let the user
      // retry. Mirrors usePaginatedLogs' handling.
      console.error("Error loading more notifications:", error)
    } finally {
      isLoadingMore.value = false
    }
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
