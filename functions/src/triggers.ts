import * as logger from "firebase-functions/logger"
import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore"
import {
  beforeUserCreated,
  beforeUserSignedIn,
} from "firebase-functions/v2/identity"
import { sendEmailInternal } from "./email.js"
import { admin, auth, db } from "./firebase.js"
import { makeEventIdempotencyKey, runIdempotentEvent } from "./idempotency.js"
import { sendNotification, sendNotificationToMany } from "./notifier.js"
import { REGION, TRIGGER_OPTS } from "./runtimeConfig.js"
import { postmarkApiKey } from "./secrets.js"
import { getTeamMembersByRoles } from "./teams.js"
import {
  IMembershipRole,
  InvitationData,
  MembershipRoleLabels,
  NotificationType,
  RoleGroups,
  normalizeMembershipRole,
} from "./types.js"

function getCloudEventId(event: unknown, fallback: string): string {
  if (
    typeof event === "object" &&
    event !== null &&
    "id" in event &&
    typeof (event as { id?: unknown }).id === "string"
  ) {
    return (event as { id: string }).id
  }
  return fallback
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
  logger.info(`[INV] sendInvitationNotification entry`, { invitationId, email })
  if (!email) {
    logger.warn(`[INV] No email on invitation`, { invitationId })
    return
  }

  // Check if the user is already registered
  let userId: string | undefined
  try {
    const userRecord = await auth.getUserByEmail(email)
    userId = userRecord.uid
    logger.info(`[INV] Recipient is a registered user`, {
      invitationId,
      email,
      userId,
    })
  } catch (error) {
    logger.info(`[INV] Recipient is NOT a registered user`, {
      invitationId,
      email,
      reason:
        error instanceof Error && "code" in error
          ? (error as { code: string }).code
          : String(error),
    })
  }

  const role = normalizeMembershipRole(invitation.role)
  if (role !== invitation.role) {
    logger.warn(
      `Invitation ${invitationId} had invalid role "${String(
        invitation.role
      )}". Falling back to "${role}".`
    )

    // Self-heal malformed invitation docs for future reads.
    try {
      await db.doc(`invitations/${invitationId}`).update({ role })
    } catch (error) {
      logger.error(
        `Failed to normalize invitation role for ${invitationId}`,
        error
      )
    }
  }

  const templateData = {
    ...buildInvitationTemplateData(invitation),
    role,
    roleLabel: MembershipRoleLabels[role],
  }

  if (userId) {
    // User exists - send via unified notification service
    const roleLabel = MembershipRoleLabels[role]
    logger.info(`[INV] Routing through sendNotification (registered user)`, {
      invitationId,
      userId,
      email,
    })
    const result = await sendNotification({
      userId,
      userEmail: email,
      type: "invitation.received",
      title: `Join ${invitation.teamName}`,
      description: `${invitation.inviterName} invited you to join ${invitation.teamName} with the role ${roleLabel}.`,
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
    logger.info(`[INV] sendNotification result`, {
      invitationId,
      userId,
      result,
    })
  } else {
    // User doesn't exist - send email only
    logger.info(
      `[INV] Routing through direct sendEmailInternal (unregistered)`,
      {
        invitationId,
        email,
      }
    )
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
      logger.info(`[INV] Direct sendEmailInternal succeeded`, {
        invitationId,
        email,
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
// Firebase Auth Triggers (V2 — Identity Platform)
// ============================================================================

/**
 * Trigger: Send Welcome Notification and Email on User Signup
 *
 * Migrated from V1 auth.user().onCreate to V2 identity.beforeUserCreated.
 * This is a blocking function but we fire the notification asynchronously
 * so it doesn't delay account creation. If sending fails, the user is
 * still created — the welcome notification is non-critical.
 */
export const onUserCreated = beforeUserCreated(
  {
    secrets: [postmarkApiKey],
    region: REGION,
    memory: TRIGGER_OPTS.memory,
    timeoutSeconds: TRIGGER_OPTS.timeoutSeconds,
    maxInstances: TRIGGER_OPTS.maxInstances,
    concurrency: TRIGGER_OPTS.concurrency,
  },
  async (event) => {
    const user = event.data
    if (!user) return

    const eventId = getCloudEventId(event, `user:${user.uid}`)
    const lockKey = makeEventIdempotencyKey("onUserCreated", eventId)

    await runIdempotentEvent({ key: lockKey }, async () => {
      try {
        // Send welcome notification and email
        // We await this to ensure the function doesn't terminate early,
        // but wrap in try/catch so failure doesn't block user creation.
        await sendNotification({
          userId: user.uid,
          userEmail: user.email ?? undefined,
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
      } catch (err) {
        // Log error but allow user creation to proceed
        logger.error("Failed to send welcome notification", err)
      }
    })
  }
)

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
    region: REGION,
    memory: TRIGGER_OPTS.memory,
    timeoutSeconds: TRIGGER_OPTS.timeoutSeconds,
    maxInstances: TRIGGER_OPTS.maxInstances,
    concurrency: TRIGGER_OPTS.concurrency,
  },
  async (event) => {
    const snapshot = event.data
    if (!snapshot) return

    const eventId = getCloudEventId(event, event.params.invitationId)
    const lockKey = makeEventIdempotencyKey("onInvitationCreated", eventId)

    await runIdempotentEvent({ key: lockKey }, async () => {
      await sendInvitationNotification(
        snapshot.data() as InvitationData,
        event.params.invitationId
      )
    })
  }
)

/**
 * Trigger: Handle invitation updates (declined, resent)
 */
export const onInvitationUpdated = onDocumentUpdated(
  {
    document: "invitations/{invitationId}",
    secrets: [postmarkApiKey],
    region: REGION,
    memory: TRIGGER_OPTS.memory,
    timeoutSeconds: TRIGGER_OPTS.timeoutSeconds,
    maxInstances: TRIGGER_OPTS.maxInstances,
    concurrency: TRIGGER_OPTS.concurrency,
  },
  async (event) => {
    const snapshot = event.data
    if (!snapshot) return

    const fallbackEventId = `${event.params.invitationId}:${
      snapshot.after.updateTime?.toMillis?.() ?? "unknown"
    }`
    const eventId = getCloudEventId(event, fallbackEventId)
    const lockKey = makeEventIdempotencyKey("onInvitationUpdated", eventId)

    await runIdempotentEvent({ key: lockKey }, async () => {
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
    })
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
    region: REGION,
    memory: TRIGGER_OPTS.memory,
    timeoutSeconds: TRIGGER_OPTS.timeoutSeconds,
    maxInstances: TRIGGER_OPTS.maxInstances,
    concurrency: TRIGGER_OPTS.concurrency,
  },
  async (event) => {
    const snapshot = event.data
    if (!snapshot) return

    const { teamId, userId } = event.params
    const eventId = getCloudEventId(event, `${teamId}:${userId}`)
    const lockKey = makeEventIdempotencyKey("onMembershipCreated", eventId)

    await runIdempotentEvent({ key: lockKey }, async () => {
      const membership = snapshot.data()
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
    })
  }
)

/**
 * Trigger: Notify User when they are removed from a team
 *
 * Migrated from V1 firestore.document().onDelete to V2 onDocumentDeleted.
 * Now benefits from Gen 2 runtime with explicit region, memory, and instance caps.
 */
export const onMembershipDeleted = onDocumentDeleted(
  {
    document: "teams/{teamId}/memberships/{userId}",
    secrets: [postmarkApiKey],
    region: REGION,
    memory: TRIGGER_OPTS.memory,
    timeoutSeconds: TRIGGER_OPTS.timeoutSeconds,
    maxInstances: TRIGGER_OPTS.maxInstances,
    concurrency: TRIGGER_OPTS.concurrency,
  },
  async (event) => {
    const snapshot = event.data
    if (!snapshot) return

    const { teamId, userId } = event.params
    const eventId = getCloudEventId(event, `${teamId}:${userId}`)
    const lockKey = makeEventIdempotencyKey("onMembershipDeleted", eventId)

    await runIdempotentEvent({ key: lockKey }, async () => {
      const membership = snapshot.data()
      const teamName = membership?.team?.name || "a team"

      await sendNotification({
        userId,
        userEmail: membership?.user?.email,
        type: "member.removed",
        title: "Removed from Team",
        description: `You have been removed from ${teamName}.`,
        url: "/teams",
        source: {
          entityType: "team",
          entityId: teamId,
        },
        emailData: {
          templateData: { teamName },
        },
      })
    })
  }
)

// ============================================================================
// Firebase Auth Triggers — SSO Enforcement & Auto-Provisioning
// ============================================================================

/**
 * Trigger: Enforce SSO policy and auto-provision memberships on sign-in.
 *
 * When a user signs in:
 * 1. Extract their email domain
 * 2. Check if a team enforces SSO for that domain
 * 3. If enforced and the sign-in provider doesn't match, block the sign-in
 * 4. If auto-provisioning is enabled and user has no membership, create one
 */
export const onUserSignedIn = beforeUserSignedIn(
  {
    region: REGION,
    memory: TRIGGER_OPTS.memory,
    timeoutSeconds: TRIGGER_OPTS.timeoutSeconds,
    maxInstances: TRIGGER_OPTS.maxInstances,
    concurrency: TRIGGER_OPTS.concurrency,
  },
  async (event) => {
    const user = event.data
    if (!user?.email) return

    const domain = user.email.split("@")[1]?.toLowerCase()
    if (!domain) return

    const domainSnap = await db.doc(`sso-domains/${domain}`).get()
    if (!domainSnap.exists) return

    const domainData = domainSnap.data()
    if (!domainData?.teamId || !domainData?.providerId) return

    const teamId = domainData.teamId as string
    const expectedProviderId = domainData.providerId as string
    const enforced = Boolean(domainData.enforced)

    // Determine the sign-in provider from the event
    const signInProvider =
      event.credential?.providerId ??
      event.additionalUserInfo?.providerId ??
      undefined

    // Enforce SSO: block non-SSO sign-ins if enforced
    if (enforced && signInProvider !== expectedProviderId) {
      throw new Error(
        "Your organization requires SSO login. Please sign in using your organization's SSO provider."
      )
    }

    // Auto-provisioning: create membership for first-time SSO users
    if (signInProvider === expectedProviderId) {
      const securitySnap = await db
        .doc(`teams/${teamId}/settings/security`)
        .get()
      const ssoConfig = securitySnap.data()?.sso

      if (ssoConfig?.autoProvision && user.uid) {
        const membershipRef = db.doc(`teams/${teamId}/memberships/${user.uid}`)
        const membershipSnap = await membershipRef.get()

        if (!membershipSnap.exists) {
          const defaultRole =
            ssoConfig.defaultRole === "guest" ? "guest" : "member"
          const teamSnap = await db.doc(`teams/${teamId}`).get()
          const teamData = teamSnap.data()

          await membershipRef.set({
            userId: user.uid,
            teamId,
            role: defaultRole,
            user: {
              displayName: user.displayName || null,
              email: user.email || null,
              photoURL: user.photoURL || null,
            },
            team: {
              name: teamData?.name || null,
              photoURL: teamData?.photoURL || null,
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          })

          logger.info(
            `Auto-provisioned membership for ${user.email} in team ${teamId} with role ${defaultRole}`
          )
        }
      }
    }
  }
)
