import * as logger from "firebase-functions/logger"
import {
  CallableRequest,
  HttpsError,
  onCall,
} from "firebase-functions/v2/https"
import { COST_BUDGET } from "./costBudget.js"
import { sendEmailInternal } from "./email.js"
import { admin, db } from "./firebase.js"
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
  snapshot: admin.firestore.DocumentSnapshot
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
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
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

    transaction.set(membershipRef, {
      userId: uid,
      teamId: invitation.teamId,
      role: invitationRole,
      user: userData,
      team: teamSnap.data() ?? {},
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    transaction.delete(invRef)

    const userPreferencesRef = getUserPreferencesRef(uid)
    const userPreferencesSnap = await transaction.get(userPreferencesRef)
    const currentTeamId = readSelectedTeamId(userPreferencesSnap) ?? null

    if (!currentTeamId) {
      transaction.set(
        userPreferencesRef,
        {
          currentTeamId: invitation.teamId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
