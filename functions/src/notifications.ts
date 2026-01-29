import admin from "firebase-admin"
import * as logger from "firebase-functions/logger"
import * as functions from "firebase-functions/v1"
import { onDocumentCreated } from "firebase-functions/v2/firestore"
import { HttpsError, onCall } from "firebase-functions/v2/https"

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp()
}

const db = admin.firestore()

type NotificationStatus = "inbox" | "saved" | "done"
type NotificationType = "welcome" | "invitation"

// Interface for Notification
interface NotificationData {
  type: NotificationType
  title: string
  description: string
  url: string
  status: NotificationStatus
  read: boolean
  source?: {
    entityType: string
    entityId: string
  }
  createdAt: admin.firestore.FieldValue
}

interface NotificationPreferences {
  enabled: boolean
  mutedTypes: string[]
}

/**
 * Helper to check user preferences and create notification
 */
async function createNotification(
  userId: string,
  notification: Omit<NotificationData, "createdAt" | "status" | "read">
) {
  try {
    const prefsSnap = await db
      .doc(`users/${userId}/notificationPreferences/default`)
      .get()
    const prefs = prefsSnap.data() as NotificationPreferences | undefined

    // Check if notifications are globally disabled or this specific type is muted
    if (prefs) {
      if (prefs.enabled === false) {
        logger.info(
          `Notification suppressed for user ${userId}: globally disabled`
        )
        return
      }
      if (prefs.mutedTypes?.includes(notification.type)) {
        logger.info(
          `Notification suppressed for user ${userId}: type ${notification.type} muted`
        )
        return
      }
    }

    await db.collection(`users/${userId}/notifications`).add({
      ...notification,
      status: "inbox",
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    logger.info(`Notification created for user ${userId}: ${notification.type}`)
  } catch (error) {
    logger.error(`Error creating notification for user ${userId}`, error)
  }
}

/**
 * Trigger: Send Welcome Notification on User Signup
 */
export const onUserCreated = functions.auth.user().onCreate(async (user) => {
  await createNotification(user.uid, {
    type: "welcome",
    title: "Welcome to LectorNaut!",
    description:
      "We're excited to have you on board. Check out our getting started guide.",
    url: "/welcome", // Adjust as needed
  })
})

/**
 * Trigger: Notify User on Invitation Receipt
 */
export const onInvitationCreated = onDocumentCreated(
  "invitations/{invitationId}",
  async (event) => {
    const snapshot = event.data
    if (!snapshot) {
      return
    }
    const invitation = snapshot.data()
    const email = invitation.email

    if (!email) {
      logger.warn(`Invitation ${event.params.invitationId} missing email`)
      return
    }

    // Find user by email to get UID (if they exist)
    try {
      const userRecord = await admin.auth().getUserByEmail(email)
      await createNotification(userRecord.uid, {
        type: "invitation",
        title: `Join ${invitation.teamName}`,
        description: `${invitation.inviteeName} invited you to join ${invitation.teamName} as a ${invitation.role}.`,
        url: `/join?code=${invitation.code}`,
        source: {
          entityType: "invitation",
          entityId: event.params.invitationId,
        },
      })
    } catch (error) {
      // User might not exist yet, which is fine for invitations
      logger.info(
        `${error} Invited email ${email} is not a registered user yet.`
      )
    }
  }
)

/**
 * Callable: Mark all notifications as read
 */
export const markAllNotificationsRead = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    )
  }
  const uid = request.auth.uid
  const status = request.data?.status as NotificationStatus | undefined
  const batch = db.batch()

  // Query unread notifications
  let q = db.collection(`users/${uid}/notifications`).where("read", "==", false)

  if (status) {
    q = q.where("status", "==", status)
  }

  const unreadSnap = await q.limit(500).get()

  if (unreadSnap.empty) {
    return { count: 0 }
  }

  unreadSnap.docs.forEach((doc) => {
    batch.update(doc.ref, { read: true })
  })

  await batch.commit()
  return { count: unreadSnap.size }
})

/**
 * Callable: Mark all notifications as unread
 */
export const markAllNotificationsUnread = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    )
  }
  const uid = request.auth.uid
  const status = request.data?.status as NotificationStatus | undefined
  const batch = db.batch()

  // Query read notifications
  let q = db.collection(`users/${uid}/notifications`).where("read", "==", true)

  if (status) {
    q = q.where("status", "==", status)
  }

  const readSnap = await q.limit(500).get()

  if (readSnap.empty) {
    return { count: 0 }
  }

  readSnap.docs.forEach((doc) => {
    batch.update(doc.ref, { read: false })
  })

  await batch.commit()
  return { count: readSnap.size }
})

/**
 * Callable: Mark all notifications as done
 */
export const markAllNotificationsDone = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    )
  }
  const uid = request.auth.uid
  const status = request.data?.status as NotificationStatus | undefined
  const batch = db.batch()

  // Query non-done notifications
  let q = db
    .collection(`users/${uid}/notifications`)
    .where("status", "in", ["inbox", "saved"])

  if (status) {
    q = q.where("status", "==", status)
  }

  const activeSnap = await q.limit(500).get()

  if (activeSnap.empty) {
    return { count: 0 }
  }

  activeSnap.docs.forEach((doc) => {
    batch.update(doc.ref, { status: "done" })
  })

  await batch.commit()
  return { count: activeSnap.size }
})

/**
 * Callable: Mark all notifications as inbox
 */
export const markAllNotificationsInbox = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    )
  }
  const uid = request.auth.uid
  const status = request.data?.status as NotificationStatus | undefined
  const batch = db.batch()

  // Query non-inbox notifications
  let q = db
    .collection(`users/${uid}/notifications`)
    .where("status", "in", ["saved", "done"])

  if (status) {
    q = q.where("status", "==", status)
  }

  const activeSnap = await q.limit(500).get()

  if (activeSnap.empty) {
    return { count: 0 }
  }

  activeSnap.docs.forEach((doc) => {
    batch.update(doc.ref, { status: "inbox" })
  })

  await batch.commit()
  return { count: activeSnap.size }
})

/**
 * Callable: Mark all notifications as saved
 */
export const markAllNotificationsSaved = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    )
  }
  const uid = request.auth.uid
  const status = request.data?.status as NotificationStatus | undefined
  const batch = db.batch()

  // Query non-saved notifications
  let q = db
    .collection(`users/${uid}/notifications`)
    .where("status", "in", ["inbox", "done"])

  if (status) {
    q = q.where("status", "==", status)
  }

  const activeSnap = await q.limit(500).get()

  if (activeSnap.empty) {
    return { count: 0 }
  }

  activeSnap.docs.forEach((doc) => {
    batch.update(doc.ref, { status: "saved" })
  })

  await batch.commit()
  return { count: activeSnap.size }
})

/**
 * Callable: Delete all notifications
 */
export const deleteAllNotifications = onCall(async (request) => {
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

  if (status) {
    q = q.where("status", "==", status)
  }

  const snap = await q.limit(500).get()

  if (snap.empty) {
    return { count: 0 }
  }

  snap.docs.forEach((doc) => {
    batch.delete(doc.ref)
  })

  await batch.commit()
  return { count: snap.size }
})
