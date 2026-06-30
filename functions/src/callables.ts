import type { DocumentSnapshot, Query } from "firebase-admin/firestore"
import { FieldValue } from "firebase-admin/firestore"
import * as logger from "firebase-functions/logger"
import {
  CallableRequest,
  HttpsError,
  onCall,
} from "firebase-functions/v2/https"
import { BUILT_IN_AGENTS_BY_ID, isBuiltInAgentId } from "./builtInAgents.js"
import { COST_BUDGET } from "./costBudget.js"
import { sendEmailInternal } from "./email.js"
import { db } from "./firebase.js"
import { CALLABLE_OPTS } from "./runtimeConfig.js"
import { postmarkApiKey } from "./secrets.js"
import {
  InvitationData,
  NotificationStatus,
  normalizeMembershipRole,
} from "./types.js"

function normalizeEmail(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null
  const normalized = email.trim().toLowerCase()
  return normalized ? normalized : null
}

const getUserPreferencesRef = (userId: string) =>
  db.doc(`users/${userId}/settings/preferences`)

function readSelectedTeamId(
  snapshot: DocumentSnapshot
): string | null | undefined {
  if (!snapshot.exists) return undefined

  const currentTeamId = snapshot.data()?.currentTeamId
  if (currentTeamId === null) return null
  return typeof currentTeamId === "string" ? currentTeamId : undefined
}

/**
 * Generic helper to update or delete multiple notifications in batch.
 * Handles authentication, query building, and batch operations.
 */
async function batchUpdateNotifications(
  request: CallableRequest,
  queryModifier: (q: Query) => Query,
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

  let q: Query = db.collection(`users/${uid}/notifications`)
  q = queryModifier(q)

  if (status) {
    q = q.where("status", "==", status)
  }

  const snap = await q.limit(COST_BUDGET.QUERY_MAX_LIMIT).get()

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
export const markAllNotificationsRead = onCall(CALLABLE_OPTS, (request) =>
  batchUpdateNotifications(request, (q) => q.where("read", "==", false), {
    read: true,
  })
)

/**
 * Mark all notifications as unread
 */
export const markAllNotificationsUnread = onCall(CALLABLE_OPTS, (request) =>
  batchUpdateNotifications(request, (q) => q.where("read", "==", true), {
    read: false,
  })
)

/**
 * Mark all notifications as done
 */
export const markAllNotificationsDone = onCall(CALLABLE_OPTS, (request) =>
  batchUpdateNotifications(
    request,
    (q) => q.where("status", "in", ["inbox", "saved"]),
    { status: "done" }
  )
)

/**
 * Mark all notifications as inbox
 */
export const markAllNotificationsInbox = onCall(CALLABLE_OPTS, (request) =>
  batchUpdateNotifications(
    request,
    (q) => q.where("status", "in", ["saved", "done"]),
    { status: "inbox" }
  )
)

/**
 * Mark all notifications as saved
 */
export const markAllNotificationsSaved = onCall(CALLABLE_OPTS, (request) =>
  batchUpdateNotifications(
    request,
    (q) => q.where("status", "in", ["inbox", "done"]),
    { status: "saved" }
  )
)

/**
 * Delete all notifications
 */
export const deleteAllNotifications = onCall(CALLABLE_OPTS, (request) =>
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

/**
 * Send a test notification to the calling user via a specific channel.
 */
export const sendTestNotification = onCall(
  { ...CALLABLE_OPTS, secrets: [postmarkApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      )
    }

    const channel = request.data?.channel
    if (
      typeof channel !== "string" ||
      !["email", "inApp", "native"].includes(channel)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Channel must be one of: email, inApp, native."
      )
    }

    const uid = request.auth.uid
    const userEmail = request.auth.token.email

    if (channel === "email") {
      if (!userEmail) {
        throw new HttpsError(
          "failed-precondition",
          "No email address associated with this account."
        )
      }

      await sendEmailInternal({
        email: userEmail,
        subject: "Test notification",
        template: "notification.test",
        data: {
          title: "Test notification",
          description:
            "This is a test email notification. Everything is working!",
          ctaUrl: "https://lectornaut.com/settings/notifications",
        },
      })
    } else if (channel === "inApp") {
      await db.collection(`users/${uid}/notifications`).add({
        type: "notification.test",
        title: "Test notification",
        description:
          "This is a test in-app notification. Everything is working!",
        url: "/settings/notifications",
        status: "inbox",
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      })
    } else if (channel === "native") {
      // Native notifications are triggered from the client side.
      // Return success so the client knows it can fire the native notification.
    }

    return { success: true, channel }
  }
)

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
  const authedEmail = normalizeEmail(auth.token.email)

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
    const invitationRole = normalizeMembershipRole(invitation.role)
    if (invitationRole !== invitation.role) {
      logger.warn(
        `Invitation ${invitationId} had invalid role "${String(
          invitation.role
        )}" during acceptance. Falling back to "${invitationRole}".`
      )
    }

    if (invitation.status !== "pending") {
      throw new HttpsError(
        "failed-precondition",
        "Only pending invitations can be accepted."
      )
    }

    if (!authedEmail || normalizeEmail(invitation.email) !== authedEmail) {
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

    const userPreferencesRef = getUserPreferencesRef(uid)
    const userPreferencesSnap = await transaction.get(userPreferencesRef)
    const currentTeamId = readSelectedTeamId(userPreferencesSnap) ?? null

    // Read every workspace BEFORE any write so the new member can be seeded into
    // each `memberUids` atomically with the membership create. Folding this into
    // the transaction (rather than a post-commit fan-out) guarantees the member
    // sees the team's workspaces the instant they join — a missed add would
    // otherwise hide every workspace with no recovery path (the invitation is
    // consumed in this same transaction).
    const workspacesSnap = await transaction.get(
      db.collection(`teams/${invitation.teamId}/workspaces`).select()
    )

    transaction.set(membershipRef, {
      userId: uid,
      teamId: invitation.teamId,
      role: invitationRole,
      user: userData,
      team: teamSnap.data() ?? {},
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    for (const ws of workspacesSnap.docs) {
      transaction.update(ws.ref, {
        memberUids: FieldValue.arrayUnion(uid),
      })
    }

    transaction.delete(invRef)

    if (!currentTeamId) {
      transaction.set(
        userPreferencesRef,
        {
          currentTeamId: invitation.teamId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    }
  })

  return { success: true }
})

type PublicProfileMember = {
  userId: string
  displayName: string
  photoURL: string | null
}

type PublicProfileTeam = {
  teamId: string
  name: string
  photoURL: string | null
}

function toPublicProfileMember(input: {
  userId?: unknown
  user?: {
    displayName?: unknown
    photoURL?: unknown
  }
}): PublicProfileMember | null {
  const userId = typeof input.userId === "string" ? input.userId : null
  if (!userId) return null

  const displayNameValue = input.user?.displayName
  const displayName =
    typeof displayNameValue === "string" && displayNameValue.trim().length > 0
      ? displayNameValue.trim()
      : userId

  const photoURL =
    typeof input.user?.photoURL === "string" ? input.user.photoURL : null

  return {
    userId,
    displayName,
    photoURL,
  }
}

async function getPublicMembersForTeam(teamId: string): Promise<{
  members: PublicProfileMember[]
  memberCount: number
}> {
  const membershipsSnap = await db
    .collection(`teams/${teamId}/memberships`)
    .select("userId", "user")
    .limit(COST_BUDGET.QUERY_MAX_LIMIT)
    .get()

  const members = membershipsSnap.docs
    .map((docSnap) =>
      toPublicProfileMember(
        docSnap.data() as {
          userId?: unknown
          user?: {
            displayName?: unknown
            photoURL?: unknown
          }
        }
      )
    )
    .filter((member): member is PublicProfileMember => !!member)
    .sort((a, b) => a.displayName.localeCompare(b.displayName))

  return {
    members,
    memberCount: members.length,
  }
}

/**
 * Returns public teams for a public user profile.
 * Works without auth and only exposes public team data.
 */
export const getPublicTeamsForUser = onCall(CALLABLE_OPTS, async (request) => {
  const rawUserId = request.data?.userId
  const userId =
    typeof rawUserId === "string" ? rawUserId.trim() : String(rawUserId ?? "")

  if (!userId) {
    throw new HttpsError("invalid-argument", "userId is required.")
  }

  const userSnap = await db.doc(`users/${userId}`).get()
  if (!userSnap.exists || userSnap.data()?.isPublic !== true) {
    return {
      teams: [] as PublicProfileTeam[],
      teamCount: 0,
    }
  }

  const membershipsSnap = await db
    .collectionGroup("memberships")
    .where("userId", "==", userId)
    .select("teamId", "team")
    .get()

  const candidateById = new Map<string, PublicProfileTeam>()

  membershipsSnap.docs.forEach((docSnap) => {
    const data = docSnap.data() as {
      teamId?: unknown
      team?: {
        name?: unknown
        photoURL?: unknown
      }
    }

    const teamId = typeof data.teamId === "string" ? data.teamId : null
    const team = data.team ?? {}
    const name =
      typeof team.name === "string" && team.name.trim().length > 0
        ? team.name.trim()
        : null

    if (!teamId || !name || candidateById.has(teamId)) return

    candidateById.set(teamId, {
      teamId,
      name,
      photoURL: typeof team.photoURL === "string" ? team.photoURL : null,
    })
  })

  if (candidateById.size === 0) {
    return {
      teams: [] as PublicProfileTeam[],
      teamCount: 0,
    }
  }

  const teamRefs = [...candidateById.keys()].map((teamId) =>
    db.doc(`teams/${teamId}`)
  )
  const teamSnaps = await db.getAll(...teamRefs)

  const teams = teamSnaps
    .map((teamSnap) => {
      if (!teamSnap.exists) return null
      const teamData = teamSnap.data() ?? {}
      if (teamData.isPublic !== true) return null

      const fallback = candidateById.get(teamSnap.id)
      if (!fallback) return null

      const name =
        typeof teamData.name === "string" && teamData.name.trim().length > 0
          ? teamData.name.trim()
          : fallback.name

      if (!name) return null

      return {
        teamId: teamSnap.id,
        name,
        photoURL:
          typeof teamData.photoURL === "string"
            ? teamData.photoURL
            : fallback.photoURL,
      } satisfies PublicProfileTeam
    })
    .filter((team): team is PublicProfileTeam => !!team)
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    teams,
    teamCount: teams.length,
  }
})

/**
 * Returns members for a public team profile.
 * This endpoint is intentionally callable without auth and only exposes public data.
 */
export const getPublicTeamMembers = onCall(CALLABLE_OPTS, async (request) => {
  const rawTeamId = request.data?.teamId
  const teamId =
    typeof rawTeamId === "string" ? rawTeamId.trim() : String(rawTeamId ?? "")

  if (!teamId) {
    throw new HttpsError("invalid-argument", "teamId is required.")
  }

  const teamSnap = await db.doc(`teams/${teamId}`).get()
  if (!teamSnap.exists) {
    return {
      members: [] as PublicProfileMember[],
      memberCount: 0,
    }
  }

  const isPublic = teamSnap.data()?.isPublic === true
  let canRead = isPublic

  if (!canRead && request.auth?.uid) {
    const membershipSnap = await db
      .doc(`teams/${teamId}/memberships/${request.auth.uid}`)
      .get()
    canRead = membershipSnap.exists
  }

  if (!canRead) {
    return {
      members: [] as PublicProfileMember[],
      memberCount: 0,
    }
  }

  const { members, memberCount } = await getPublicMembersForTeam(teamId)
  return { members, memberCount }
})

type PublicAgentProfileStatus = "active" | "disabled" | "archived"

type PublicAgentProfile = {
  id: string
  name: string
  description: string
  avatarSeed: string
  isBuiltIn: boolean
  status: PublicAgentProfileStatus
  /**
   * EFFECTIVE public reachability — `team.isPublic && agent.isPublic` —
   * i.e. "can an anonymous viewer open this profile". Members of private
   * teams (who get "found" via the membership gate) see `false` here.
   */
  isPublic: boolean
  /** Membership `createdAt` — when the agent was added as a team member. */
  memberSinceMillis: number | null
  /** Agent doc `createdAt` (null for built-ins — no doc). */
  createdAtMillis: number | null
}

const toMillisOrNull = (value: unknown): number | null => {
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof (value as { toMillis: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis()
  }
  return null
}

/**
 * Returns the public profile for an agent by its uid. Works without auth.
 *
 * Resolution mirrors the "agents are team members" model: a CUSTOM agent
 * becomes publicly resolvable once an admin enrolls it as a team member
 * (`addTeamAgentMember` writes a membership doc carrying a queryable
 * `agentId`). Built-in agents (`_`-prefixed ids) are platform personas —
 * they resolve from the in-process registry with no team context, and MUST
 * short-circuit before the membership query because the same built-in id
 * exists in every team (the query would leak an arbitrary team's
 * enrollment).
 *
 * Privacy mirrors the public user/team profile surface: a public team's
 * agents are visible to anyone; a private team's agents only to its
 * members. Only display fields leave the server — never prompts, tool
 * toggles, or spec internals (same secrecy rule the audit log applies).
 */
export const getPublicAgentProfile = onCall(CALLABLE_OPTS, async (request) => {
  const rawAgentId = request.data?.agentId
  const agentId = typeof rawAgentId === "string" ? rawAgentId.trim() : ""

  if (!agentId) {
    throw new HttpsError("invalid-argument", "agentId is required.")
  }

  if (isBuiltInAgentId(agentId)) {
    const definition = BUILT_IN_AGENTS_BY_ID[agentId]
    if (!definition) {
      return { status: "not_found" as const }
    }
    const agent: PublicAgentProfile = {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      avatarSeed: definition.avatarSeed,
      isBuiltIn: true,
      status: "active",
      isPublic: true,
      memberSinceMillis: null,
      createdAtMillis: null,
    }
    return { status: "found" as const, agent, team: null }
  }

  // Primary: direct lookup via the `id` field custom integration docs
  // carry in their body (written at create; older docs are healed by
  // `listIntegrations` and by the fallback below). Resolves every custom
  // agent regardless of team-member enrollment.
  let teamId: string | null = null
  let agentDoc: DocumentSnapshot | null = null

  const integrationSnap = await db
    .collectionGroup("integrations")
    .where("id", "==", agentId)
    .limit(1)
    .get()
  const integrationHit = integrationSnap.docs[0]
  if (integrationHit && integrationHit.data()?.type === "agent") {
    agentDoc = integrationHit
    teamId = integrationHit.ref.parent.parent?.id ?? null
  }

  // Fallback: enrollment membership — covers docs written before the body
  // `id` field shipped (their membership has carried a queryable `agentId`
  // since agents-as-members).
  if (!teamId) {
    const membershipSnap = await db
      .collectionGroup("memberships")
      .where("agentId", "==", agentId)
      .limit(1)
      .get()
    const membershipData = membershipSnap.docs[0]?.data() as
      { teamId?: unknown } | undefined
    teamId =
      typeof membershipData?.teamId === "string" ? membershipData.teamId : null
  }

  if (!teamId) {
    return { status: "not_found" as const }
  }

  // Live agent doc — read BEFORE the visibility gate because the per-agent
  // `isPublic` flag participates in it. The collectionGroup hit IS the live
  // doc; the membership-fallback path reads it now. A missing doc means the
  // agent was hard-deleted and the membership is residue.
  if (!agentDoc) {
    const directSnap = await db
      .doc(`teams/${teamId}/integrations/${agentId}`)
      .get()
    if (directSnap.exists) {
      agentDoc = directSnap
      // Targeted heal: this doc just proved reachable only through its
      // membership — backfill the queryable id so it keeps resolving even
      // if the enrollment is later removed. Fire-and-forget.
      void directSnap.ref
        .set({ id: agentId }, { merge: true })
        .catch(() => undefined)
    }
  }
  if (!agentDoc?.exists) {
    return { status: "not_found" as const }
  }
  const agentData = agentDoc.data() ?? {}
  if (agentData.type !== "agent") {
    return { status: "not_found" as const }
  }

  const teamSnap = await db.doc(`teams/${teamId}`).get()
  if (!teamSnap.exists) {
    return { status: "not_found" as const }
  }
  const teamData = teamSnap.data() ?? {}

  // Effective public visibility: the team's privacy is the outer boundary;
  // the per-agent flag opts an individual agent out within a public team.
  // Missing flag = true (opt-out convention shared with `enabled`).
  const publiclyVisible =
    teamData.isPublic === true && agentData.isPublic !== false

  let canRead = publiclyVisible
  if (!canRead && request.auth?.uid) {
    const viewerSnap = await db
      .doc(`teams/${teamId}/memberships/${request.auth.uid}`)
      .get()
    canRead = viewerSnap.exists
  }
  if (!canRead) {
    return { status: "private" as const }
  }

  // Enrollment is optional — when present it contributes "member since".
  const agentMembershipSnap = await db
    .doc(`teams/${teamId}/memberships/${agentId}`)
    .get()
  const memberSinceMillis = agentMembershipSnap.exists
    ? toMillisOrNull(agentMembershipSnap.data()?.createdAt)
    : null

  const status: PublicAgentProfileStatus = agentData.archivedAt
    ? "archived"
    : agentData.enabled === false
      ? "disabled"
      : "active"

  const agent: PublicAgentProfile = {
    id: agentId,
    name: typeof agentData.name === "string" ? agentData.name : "",
    description:
      typeof agentData.description === "string" ? agentData.description : "",
    avatarSeed:
      typeof agentData.avatarSeed === "string" ? agentData.avatarSeed : "",
    isBuiltIn: false,
    status,
    isPublic: publiclyVisible,
    memberSinceMillis,
    createdAtMillis: toMillisOrNull(agentData.createdAt),
  }

  const team: PublicProfileTeam & { username: string | null } = {
    teamId,
    name: typeof teamData.name === "string" ? teamData.name : "",
    photoURL: typeof teamData.photoURL === "string" ? teamData.photoURL : null,
    username:
      typeof teamData.username === "string" && teamData.username.length > 0
        ? teamData.username
        : null,
  }

  return { status: "found" as const, agent, team }
})
