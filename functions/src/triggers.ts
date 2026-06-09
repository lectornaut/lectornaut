import { FieldValue } from "firebase-admin/firestore"
import * as logger from "firebase-functions/logger"
import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentUpdated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore"
import {
  beforeUserCreated,
  beforeUserSignedIn,
} from "firebase-functions/v2/identity"
import { sendEmailInternal } from "./email.js"
import { auth, db } from "./firebase.js"
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
import { addMemberToWorkspaces } from "./workspaceMembership.js"
import {
  listGrantingWorkspaceIdsForGroup,
  recomputeGroupRoleForMembersInWorkspace,
} from "./workspaceRoles.js"

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

/**
 * Trigger: Seed workspace participation (`memberUids`) for a new human member.
 *
 * `memberUids` is the SOLE gate on workspace visibility (the workspace read rule
 * + the `memberUids array-contains` list query), so every membership-creation
 * path must add the new member to every workspace's list. `acceptInvitation`
 * does this atomically inside its transaction, but the SSO auto-provisioning
 * path (`onUserSignedIn` below) writes the membership doc directly — without this
 * trigger an auto-provisioned user would see ZERO workspaces. Firing on every
 * membership create makes seeding uniform and, with `retry: true` + an
 * idempotent `arrayUnion`, self-healing. Agents are never participants, so they
 * are skipped. (Redundant with the invite-accept in-tx seed; the duplicate
 * `arrayUnion` is a harmless no-op.)
 */
export const onMembershipCreatedSeedWorkspaces = onDocumentCreated(
  {
    document: "teams/{teamId}/memberships/{userId}",
    region: REGION,
    memory: TRIGGER_OPTS.memory,
    timeoutSeconds: TRIGGER_OPTS.timeoutSeconds,
    maxInstances: TRIGGER_OPTS.maxInstances,
    concurrency: TRIGGER_OPTS.concurrency,
    retry: true,
  },
  async (event) => {
    const snapshot = event.data
    if (!snapshot) return
    if (snapshot.data()?.kind === "agent") return

    const { teamId, userId } = event.params
    // Let failures propagate so `retry: true` re-delivers — `arrayUnion` is
    // idempotent, so re-running converges.
    await addMemberToWorkspaces(teamId, userId)
  }
)

// ============================================================================
// Firestore Triggers — Group role denormalization (`groupRole`)
// ============================================================================
//
// Groups grant an elevate-only per-workspace role. The functions read path
// resolves a member's group role LIVE (authoritative), but firestore.rules
// can't run that query, so each per-(member, workspace) override doc carries a
// denormalized `groupRole` = the member's max group-derived role in that
// workspace. These triggers keep that denorm in sync. Both are idempotent +
// `retry: true` so a transient failure re-delivers and converges
// (`recomputeGroupRoleForMembersInWorkspace` writes only on an actual change).

/** Extract a doc's `memberIds` string array (empty when the doc is absent). */
function readMemberIds(snap: {
  exists: boolean
  data: () => Record<string, unknown> | undefined
}): string[] {
  if (!snap.exists) return []
  const ids = snap.data()?.memberIds
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string")
    : []
}

/**
 * Trigger: a group's membership changed (create / update / delete) → recompute
 * `groupRole` for the affected members (added ∪ removed) across every workspace
 * that grants this group. A pure name change touches no member, so it no-ops.
 *
 * On a callable-driven delete the grants are already gone (no granting
 * workspaces found → no-op; the delete callable recomputed synchronously). On a
 * raw console delete the grants linger, so this is the self-healing backstop:
 * the former members recompute and their `groupRole` drops (the group no longer
 * matches the live `array-contains` query).
 */
export const onGroupWritten = onDocumentWritten(
  {
    document: "teams/{teamId}/groups/{groupId}",
    region: REGION,
    memory: TRIGGER_OPTS.memory,
    timeoutSeconds: TRIGGER_OPTS.timeoutSeconds,
    maxInstances: TRIGGER_OPTS.maxInstances,
    concurrency: TRIGGER_OPTS.concurrency,
    retry: true,
  },
  async (event) => {
    if (!event.data) return
    const { teamId, groupId } = event.params
    const beforeIds = new Set(readMemberIds(event.data.before))
    const afterIds = new Set(readMemberIds(event.data.after))

    const affected = new Set<string>()
    for (const id of beforeIds) if (!afterIds.has(id)) affected.add(id)
    for (const id of afterIds) if (!beforeIds.has(id)) affected.add(id)
    if (affected.size === 0) return

    const workspaceIds = await listGrantingWorkspaceIdsForGroup(teamId, groupId)
    for (const workspaceId of workspaceIds) {
      await recomputeGroupRoleForMembersInWorkspace(teamId, workspaceId, [
        ...affected,
      ])
    }
  }
)

/**
 * Trigger: a workspace's grant for a group changed (create / update / delete) →
 * recompute `groupRole` for that group's members in that workspace. Reads the
 * group's current memberIds; if the group is gone (the delete-group callable
 * removed it + already recomputed), there are no members to touch and it
 * no-ops.
 */
export const onGroupGrantWritten = onDocumentWritten(
  {
    document: "teams/{teamId}/workspaces/{workspaceId}/groupGrants/{groupId}",
    region: REGION,
    memory: TRIGGER_OPTS.memory,
    timeoutSeconds: TRIGGER_OPTS.timeoutSeconds,
    maxInstances: TRIGGER_OPTS.maxInstances,
    concurrency: TRIGGER_OPTS.concurrency,
    retry: true,
  },
  async (event) => {
    const { teamId, workspaceId, groupId } = event.params
    const groupSnap = await db.doc(`teams/${teamId}/groups/${groupId}`).get()
    const memberIds = readMemberIds(groupSnap)
    if (memberIds.length === 0) return
    await recomputeGroupRoleForMembersInWorkspace(
      teamId,
      workspaceId,
      memberIds
    )
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
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          })

          logger.info(
            `Auto-provisioned membership for ${user.email} in team ${teamId} with role ${defaultRole}`
          )
        }
      }
    }
  }
)
