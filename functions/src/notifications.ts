import admin from "firebase-admin"
import * as logger from "firebase-functions/logger"
import * as functions from "firebase-functions/v1"
import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore"
import {
  CallableRequest,
  HttpsError,
  onCall,
} from "firebase-functions/v2/https"
import { sendEmailInternal } from "./email.js"
import { Capabilities, IMembershipRole, roleCan } from "./permissions.js"
import { postmarkApiKey } from "./secrets.js"
import {
  InvitationData,
  NotificationData,
  NotificationPreferences,
  NotificationStatus,
} from "./types.js"

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp()
}

const db = admin.firestore()

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
  } catch (error) {
    logger.error(`Error creating notification for user ${userId}`, error)
  }
}

/**
 * Generic helper to update or delete multiple notifications in batch
 */
async function batchUpdateNotifications(
  request: CallableRequest,
  queryModifier: (q: admin.firestore.Query) => admin.firestore.Query,
  updateData: Record<string, unknown> | null // null means delete
) {
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

/**
 * Trigger: Send Welcome Notification and Email on User Signup
 */
export const onUserCreated = functions
  .runWith({ secrets: ["POSTMARK_API_KEY"] })
  .auth.user()
  .onCreate(async (user) => {
    const uid = user.uid
    const email = user.email
    const displayName = user.displayName || email || "there"

    // 1. Create In-App Notification
    await createNotification(uid, {
      type: "welcome",
      title: "Welcome to LectorNaut!",
      description:
        "We're excited to have you on board. Check out our getting started guide.",
      url: "/welcome",
    })

    // 2. Send Welcome Email
    if (email) {
      try {
        await sendEmailInternal({
          email,
          subject: "Welcome to LectorNaut!",
          template: "welcome",
          data: {
            displayName,
            ctaUrl: "https://lectornaut.com/welcome",
          },
        })
      } catch (error) {
        logger.error(`Failed to send welcome email to ${email}`, error)
      }
    }
  })

/**
 * Helper to send invitation email and in-app notification
 */
async function sendInvitationCommunications(
  invitation: InvitationData,
  invitationId: string
) {
  const email = invitation.email
  if (!email) return

  // 1. Send Invitation Email
  try {
    await sendEmailInternal({
      email,
      subject: `Join ${invitation.teamName} on Lectornaut`,
      template: "invitation",
      data: {
        teamName: invitation.teamName,
        inviterName: invitation.inviterName,
        inviterEmail: invitation.inviterEmail,
        role: invitation.role,
        ctaUrl: `https://lectornaut.com/join?code=${invitation.code}`,
      },
    })
  } catch (error) {
    logger.error(`Failed to send invitation email to ${email}`, error)
  }

  // 2. Create In-App Notification (If user already exists)
  try {
    const userRecord = await admin.auth().getUserByEmail(email)
    await createNotification(userRecord.uid, {
      type: "invitation",
      title: `Join ${invitation.teamName}`,
      description: `${invitation.inviterName} invited you to join ${invitation.teamName} as a ${invitation.role}.`,
      url: `/join?code=${invitation.code}`,
      source: {
        entityType: "invitation",
        entityId: invitationId,
      },
    })
  } catch (_error) {
    logger.info(`Invited email ${email} is not a registered user yet.`)
  }
}

/**
 * Trigger: Notify User on Invitation Receipt
 */
export const onInvitationCreated = onDocumentCreated(
  {
    document: "invitations/{invitationId}",
    secrets: [postmarkApiKey],
  },
  async (event) => {
    const snapshot = event.data
    if (!snapshot) return
    await sendInvitationCommunications(
      snapshot.data() as InvitationData,
      event.params.invitationId
    )
  }
)

/**
 * Trigger: Notify Team Owners when an invitation is declined
 */
export const onInvitationUpdated = onDocumentUpdated(
  {
    document: "invitations/{invitationId}",
    secrets: [postmarkApiKey],
  },
  async (event) => {
    const snapshot = event.data
    if (!snapshot) return

    const before = snapshot.before.data()
    const after = snapshot.after.data()

    // 1. Check if status changed to 'declined'
    if (before.status !== "declined" && after.status === "declined") {
      const invitation = after
      const teamId = invitation.teamId

      // Notify owners and admins
      const membersSnap = await db
        .collection(`teams/${teamId}/memberships`)
        .get()
      const adminsAndOwners = membersSnap.docs
        .map((doc) => doc.data())
        .filter((m) =>
          roleCan(m.role as IMembershipRole, Capabilities.INVITE_MEMBER)
        )

      await Promise.all(
        adminsAndOwners.map((admin) =>
          createNotification(admin.userId, {
            type: "system",
            title: "Invitation Declined",
            description: `${invitation.email} declined the invitation to join ${invitation.teamName}.`,
            url: `/teams/${teamId}`,
            source: {
              entityType: "invitation",
              entityId: event.params.invitationId,
            },
          })
        )
      )
    }

    // 2. Check if a resend was triggered (resentAt timestamp was updated)
    const beforeResentAt = before.resentAt?.toMillis?.() || 0
    const afterResentAt = after.resentAt?.toMillis?.() || 0

    if (afterResentAt > 0 && afterResentAt > beforeResentAt) {
      await sendInvitationCommunications(
        after as InvitationData,
        event.params.invitationId
      )
    }
  }
)

/**
 * Trigger: Notify Team Owners when a new member joins
 */
export const onMembershipCreated = onDocumentCreated(
  "teams/{teamId}/memberships/{userId}",
  async (event) => {
    const snapshot = event.data
    if (!snapshot) return

    const membership = snapshot.data()
    const teamId = event.params.teamId
    const userId = event.params.userId
    const userName =
      membership.user?.displayName || membership.user?.email || "Someone"

    // Notify all owners and admins of the team (except the joining user if they already exist)
    const membersSnap = await db.collection(`teams/${teamId}/memberships`).get()
    const adminsAndOwners = membersSnap.docs
      .map((doc) => doc.data())
      .filter(
        (m) =>
          roleCan(m.role as IMembershipRole, Capabilities.INVITE_MEMBER) &&
          m.userId !== userId
      )

    await Promise.all(
      adminsAndOwners.map((admin) =>
        createNotification(admin.userId, {
          type: "system",
          title: "New Team Member",
          description: `${userName} has joined ${membership.team?.name || "your team"}.`,
          url: `/teams/${teamId}`,
          source: {
            entityType: "team",
            entityId: teamId,
          },
        })
      )
    )
  }
)

/**
 * Trigger: Notify User when they are removed from a team
 */
export const onMembershipDeleted = functions.firestore
  .document("teams/{teamId}/memberships/{userId}")
  .onDelete(async (snapshot, event) => {
    const membership = snapshot.data()
    const userId = event.params.userId
    const teamName = membership?.team?.name || "a team"

    await createNotification(userId, {
      type: "system",
      title: "Removed from Team",
      description: `You have been removed from ${teamName}.`,
      url: "/teams",
      source: {
        entityType: "team",
        entityId: event.params.teamId,
      },
    })
  })

/**
 * Callable: Mark all notifications as read
 */
export const markAllNotificationsRead = onCall((request) =>
  batchUpdateNotifications(request, (q) => q.where("read", "==", false), {
    read: true,
  })
)

/**
 * Callable: Mark all notifications as unread
 */
export const markAllNotificationsUnread = onCall((request) =>
  batchUpdateNotifications(request, (q) => q.where("read", "==", true), {
    read: false,
  })
)

/**
 * Callable: Mark all notifications as done
 */
export const markAllNotificationsDone = onCall((request) =>
  batchUpdateNotifications(
    request,
    (q) => q.where("status", "in", ["inbox", "saved"]),
    { status: "done" }
  )
)

/**
 * Callable: Mark all notifications as inbox
 */
export const markAllNotificationsInbox = onCall((request) =>
  batchUpdateNotifications(
    request,
    (q) => q.where("status", "in", ["saved", "done"]),
    { status: "inbox" }
  )
)

/**
 * Callable: Mark all notifications as saved
 */
export const markAllNotificationsSaved = onCall((request) =>
  batchUpdateNotifications(
    request,
    (q) => q.where("status", "in", ["inbox", "done"]),
    { status: "saved" }
  )
)

/**
 * Callable: Delete all notifications
 */
export const deleteAllNotifications = onCall((request) =>
  batchUpdateNotifications(
    request,
    (q) => q, // No additional filter
    null // null means delete
  )
)
