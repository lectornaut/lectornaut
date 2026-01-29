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

// Interface for Notification
interface NotificationData {
  type: "welcome" | "invitation"
  title: string
  description: string
  url: string
  status: "inbox" | "saved" | "done"
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
  const batch = db.batch()

  // Query unread notifications
  const unreadSnap = await db
    .collection(`users/${uid}/notifications`)
    .where("read", "==", false)
    .limit(500) // Batch limit
    .get()

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
  const batch = db.batch()

  // Query non-done notifications
  const activeSnap = await db
    .collection(`users/${uid}/notifications`)
    .where("status", "in", ["inbox", "saved"])
    .limit(500)
    .get()

  if (activeSnap.empty) {
    return { count: 0 }
  }

  activeSnap.docs.forEach((doc) => {
    batch.update(doc.ref, { status: "done" })
  })

  await batch.commit()
  return { count: activeSnap.size }
})
