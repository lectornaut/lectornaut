import admin from "firebase-admin"
import {
  CallableRequest,
  HttpsError,
  onCall,
} from "firebase-functions/v2/https"
import { NotificationStatus } from "./types.js"

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp()
}

const db = admin.firestore()

/**
 * Generic helper to update or delete multiple notifications in batch.
 * Handles authentication, query building, and batch operations.
 */
async function batchUpdateNotifications(
  request: CallableRequest,
  queryModifier: (q: admin.firestore.Query) => admin.firestore.Query,
  updateData: Record<string, unknown> | null // null means delete
): Promise<{ count: number }> {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    )
  }

  const uid = request.auth.uid
  const status = request.data?.status as NotificationStatus | undefined
  const batch = db.batch()

  let q: admin.firestore.Query = db.collection(`users/${uid}/notifications`)
  q = queryModifier(q)

  if (status) {
    q = q.where("status", "==", status)
  }

  const snap = await q.limit(500).get()

  if (snap.empty) {
    return { count: 0 }
  }

  snap.docs.forEach((doc) => {
    if (updateData === null) {
      batch.delete(doc.ref)
    } else {
      batch.update(doc.ref, updateData)
    }
  })

  await batch.commit()
  return { count: snap.size }
}

// ============================================================================
// Callable Functions for Batch Notification Operations
// ============================================================================

/**
 * Mark all notifications as read
 */
export const markAllNotificationsRead = onCall((request) =>
  batchUpdateNotifications(request, (q) => q.where("read", "==", false), {
    read: true,
  })
)

/**
 * Mark all notifications as unread
 */
export const markAllNotificationsUnread = onCall((request) =>
  batchUpdateNotifications(request, (q) => q.where("read", "==", true), {
    read: false,
  })
)

/**
 * Mark all notifications as done
 */
export const markAllNotificationsDone = onCall((request) =>
  batchUpdateNotifications(
    request,
    (q) => q.where("status", "in", ["inbox", "saved"]),
    { status: "done" }
  )
)

/**
 * Mark all notifications as inbox
 */
export const markAllNotificationsInbox = onCall((request) =>
  batchUpdateNotifications(
    request,
    (q) => q.where("status", "in", ["saved", "done"]),
    { status: "inbox" }
  )
)

/**
 * Mark all notifications as saved
 */
export const markAllNotificationsSaved = onCall((request) =>
  batchUpdateNotifications(
    request,
    (q) => q.where("status", "in", ["inbox", "done"]),
    { status: "saved" }
  )
)

/**
 * Delete all notifications
 */
export const deleteAllNotifications = onCall((request) =>
  batchUpdateNotifications(
    request,
    (q) => q, // No additional filter
    null // null means delete
  )
)
