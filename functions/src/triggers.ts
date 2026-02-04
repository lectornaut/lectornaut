import admin from "firebase-admin"
import * as logger from "firebase-functions/logger"
import * as functions from "firebase-functions/v1"
import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore"
import { sendNotification, sendNotificationToMany } from "./notifier.js"
import { postmarkApiKey } from "./secrets.js"
import { getTeamMembersByRoles } from "./teams.js"
import {
  IMembershipRole,
  InvitationData,
  NotificationType,
  RoleGroups,
} from "./types.js"

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp()
}

// ============================================================================
// Invitation Email Helpers
// ============================================================================

/**
 * Build common invitation template data to avoid duplication
 */
function buildInvitationTemplateData(invitation: InvitationData) {
  return {
    teamName: invitation.teamName,
    inviterName: invitation.inviterName,
    inviterEmail: invitation.inviterEmail,
    role: invitation.role,
  }
}

/**
 * Send invitation notification to a user.
 * Handles both registered users (in-app + email) and non-registered users (email only).
 */
async function sendInvitationNotification(
  invitation: InvitationData,
  invitationId: string
) {
  const email = invitation.email
  if (!email) return

  // Check if the user is already registered
  let userId: string | undefined
  try {
    const userRecord = await admin.auth().getUserByEmail(email)
    userId = userRecord.uid
  } catch (_error) {
    logger.info(`Invited email ${email} is not a registered user yet.`)
  }

  const templateData = buildInvitationTemplateData(invitation)

  if (userId) {
    // User exists - send via unified notification service
    await sendNotification({
      userId,
      userEmail: email,
      type: "invitation.received",
      title: `Join ${invitation.teamName}`,
      description: `${invitation.inviterName} invited you to join ${invitation.teamName} as a ${invitation.role}.`,
      url: `/invitations?code=${invitation.code}`,
      source: {
        entityType: "invitation",
        entityId: invitationId,
      },
      emailData: {
        subject: `Join ${invitation.teamName} on Lectornaut`,
        templateData,
      },
    })
  } else {
    // User doesn't exist - send email only
    const { sendEmailInternal } = await import("./email.js")
    try {
      await sendEmailInternal({
        email,
        subject: `Join ${invitation.teamName} on Lectornaut`,
        template: "invitation.received",
        data: {
          ...templateData,
          ctaUrl: `https://lectornaut.com/invitations?code=${invitation.code}`,
        },
      })
    } catch (error) {
      logger.error(`Failed to send invitation email to ${email}`, error)
    }
  }
}

// ============================================================================
// Team Notification Helpers
// ============================================================================

/**
 * Notify team members about an event.
 * Flexible helper that supports any role combination via RoleGroups or custom roles array.
 *
 * @example
 * // Notify only admins
 * await notifyTeamMembers(teamId, RoleGroups.ADMINS, { ... })
 *
 * // Notify all members including guests
 * await notifyTeamMembers(teamId, RoleGroups.ALL, { ... })
 *
 * // Notify specific roles
 * await notifyTeamMembers(teamId, [MembershipRoles.OWNER], { ... })
 */
async function notifyTeamMembers(
  teamId: string,
  roles: readonly IMembershipRole[],
  notification: {
    type: NotificationType
    title: string
    description: string
    source: { entityType: string; entityId: string }
    templateData?: Record<string, unknown>
  },
  excludeUserId?: string
) {
  const members = await getTeamMembersByRoles(teamId, roles, excludeUserId)

  await sendNotificationToMany(
    members.map((member) => ({
      userId: member.userId,
      userEmail: member.email,
      type: notification.type,
      title: notification.title,
      description: notification.description,
      url: `/teams/${teamId}`,
      source: notification.source,
      emailData: {
        templateData: notification.templateData,
      },
    }))
  )
}

// ============================================================================
// Firebase Auth Triggers
// ============================================================================

/**
 * Trigger: Send Welcome Notification and Email on User Signup
 */
export const onUserCreated = functions
  .runWith({ secrets: ["POSTMARK_API_KEY"] })
  .auth.user()
  .onCreate(async (user) => {
    await sendNotification({
      userId: user.uid,
      userEmail: user.email,
      type: "user.welcome",
      title: "Welcome to LectorNaut!",
      description:
        "We're excited to have you on board. Check out our getting started guide.",
      url: "/welcome",
      emailData: {
        templateData: {
          displayName: user.displayName || user.email || "there",
        },
      },
    })
  })

// ============================================================================
// Firestore Triggers - Invitations
// ============================================================================

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
    await sendInvitationNotification(
      snapshot.data() as InvitationData,
      event.params.invitationId
    )
  }
)

/**
 * Trigger: Handle invitation updates (declined, resent)
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

    // Handle invitation declined
    if (before.status !== "declined" && after.status === "declined") {
      await notifyTeamMembers(after.teamId, RoleGroups.ADMINS, {
        type: "invitation.declined",
        title: "Invitation Declined",
        description: `${after.email} declined the invitation to join ${after.teamName}.`,
        source: {
          entityType: "invitation",
          entityId: event.params.invitationId,
        },
        templateData: {
          email: after.email,
          teamName: after.teamName,
        },
      })
    }

    // Handle invitation resent
    const beforeResentAt = before.resentAt?.toMillis?.() || 0
    const afterResentAt = after.resentAt?.toMillis?.() || 0

    if (afterResentAt > 0 && afterResentAt > beforeResentAt) {
      await sendInvitationNotification(
        after as InvitationData,
        event.params.invitationId
      )
    }
  }
)

// ============================================================================
// Firestore Triggers - Memberships
// ============================================================================

/**
 * Trigger: Notify Team Admins when a new member joins
 */
export const onMembershipCreated = onDocumentCreated(
  {
    document: "teams/{teamId}/memberships/{userId}",
    secrets: [postmarkApiKey],
  },
  async (event) => {
    const snapshot = event.data
    if (!snapshot) return

    const membership = snapshot.data()
    const { teamId, userId } = event.params
    const userName =
      membership.user?.displayName || membership.user?.email || "Someone"

    await notifyTeamMembers(
      teamId,
      RoleGroups.ADMINS,
      {
        type: "member.joined",
        title: "New Team Member",
        description: `${userName} has joined ${membership.team?.name || "your team"}.`,
        source: { entityType: "team", entityId: teamId },
        templateData: {
          memberName: userName,
          teamName: membership.team?.name || "your team",
        },
      },
      userId // Exclude the joining user from notifications
    )
  }
)

/**
 * Trigger: Notify User when they are removed from a team
 */
export const onMembershipDeleted = functions
  .runWith({ secrets: ["POSTMARK_API_KEY"] })
  .firestore.document("teams/{teamId}/memberships/{userId}")
  .onDelete(async (snapshot, event) => {
    const membership = snapshot.data()
    const teamName = membership?.team?.name || "a team"

    await sendNotification({
      userId: event.params.userId,
      userEmail: membership?.user?.email,
      type: "member.removed",
      title: "Removed from Team",
      description: `You have been removed from ${teamName}.`,
      url: "/teams",
      source: {
        entityType: "team",
        entityId: event.params.teamId,
      },
      emailData: {
        templateData: { teamName },
      },
    })
  })
