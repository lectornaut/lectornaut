import {
  CallableRequest,
  HttpsError,
  onCall,
} from "firebase-functions/v2/https"
import { admin, db } from "./firebase.js"
import { CALLABLE_OPTS } from "./runtimeConfig.js"
import { InvitationData, NotificationStatus } from "./types.js"

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

/**
 * Delete a single notification by ID.
 * Used for individual notification deletion (sync engine blocks delete operations on notifications).
 */
export const deleteNotification = onCall(CALLABLE_OPTS, async (request) => {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    )
  }

  const uid = request.auth.uid
  const notificationId = request.data?.notificationId

  if (!notificationId || typeof notificationId !== "string") {
    throw new HttpsError(
      "invalid-argument",
      "Notification ID is required and must be a string."
    )
  }

  const notificationRef = db.doc(`users/${uid}/notifications/${notificationId}`)
  const snap = await notificationRef.get()

  if (!snap.exists) {
    throw new HttpsError("not-found", "Notification not found.")
  }

  await notificationRef.delete()
  return { success: true }
})

// ============================================================================
// Invitation Helpers
// ============================================================================

/**
 * Accept an invitation by ID.
 * Runs server-side to validate email, create membership, and clean up.
 */
export const acceptInvitation = onCall(CALLABLE_OPTS, async (request) => {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    )
  }

  const auth = request.auth
  const uid = auth.uid
  const authedEmail = auth.token.email ?? null

  const invitationId = request.data?.invitationId
  if (!invitationId || typeof invitationId !== "string") {
    throw new HttpsError("invalid-argument", "Invitation ID is required.")
  }

  await db.runTransaction(async (transaction) => {
    const invRef = db.doc(`invitations/${invitationId}`)
    const invSnap = await transaction.get(invRef)

    if (!invSnap.exists) {
      throw new HttpsError("not-found", "Invitation not found.")
    }

    const invitation = invSnap.data() as InvitationData

    if (invitation.status !== "pending") {
      throw new HttpsError(
        "failed-precondition",
        "Only pending invitations can be accepted."
      )
    }

    if (!authedEmail || invitation.email !== authedEmail) {
      throw new HttpsError(
        "permission-denied",
        "Invitation does not match authenticated user."
      )
    }

    const teamRef = db.doc(`teams/${invitation.teamId}`)
    const teamSnap = await transaction.get(teamRef)
    if (!teamSnap.exists) {
      throw new HttpsError("not-found", "Team no longer exists.")
    }

    const membershipRef = db.doc(
      `teams/${invitation.teamId}/memberships/${uid}`
    )
    const membershipSnap = await transaction.get(membershipRef)
    if (membershipSnap.exists) {
      throw new HttpsError("already-exists", "User is already a member.")
    }

    const userRef = db.doc(`users/${uid}`)
    const userSnap = await transaction.get(userRef)
    const userData = userSnap.exists
      ? userSnap.data()
      : {
          uid,
          email: authedEmail,
          displayName: auth.token.name ?? null,
          photoURL: auth.token.picture ?? null,
        }

    transaction.set(membershipRef, {
      userId: uid,
      teamId: invitation.teamId,
      role: invitation.role,
      user: userData,
      team: teamSnap.data() ?? {},
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    transaction.delete(invRef)

    if (userSnap.exists) {
      const currentTeamId = userSnap.data()?.currentTeamId ?? null
      if (!currentTeamId) {
        transaction.update(userRef, {
          currentTeamId: invitation.teamId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      }
    }
  })

  return { success: true }
})
