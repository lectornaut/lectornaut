import admin from "firebase-admin"
import {
  CallableRequest,
  HttpsError,
  onCall,
} from "firebase-functions/v2/https"
import { can, Capabilities, IMembershipRole } from "./permissions.js"

if (!admin.apps.length) {
  admin.initializeApp()
}

const db = admin.firestore()

// =============================================================================
// Audit Log Types
// =============================================================================

export type LogResourceType = "team" | "workspace" | "content" | "membership"

export interface Actor {
  userId: string
  email?: string
  role?: string
}

export interface Resource {
  type: LogResourceType
  id: string
  parentId?: string
}

export interface Context {
  ip?: string
  userAgent?: string
  authType?: "password" | "sso" | "api"
}

export interface Changes {
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  fields?: string[]
}

export interface LogEntry {
  id: string
  timestamp: admin.firestore.FieldValue | admin.firestore.Timestamp
  teamId: string
  workspaceId?: string
  actor: Actor
  action: string
  resource: Resource
  context?: Context
  changes?: Changes
}

export interface LogEventParams {
  teamId: string
  workspaceId?: string
  actor: Actor
  action: string
  resource: Resource
  context?: Context
  changes?: Changes
}

// =============================================================================
// Audit Log Utilities
// =============================================================================

function assertAuthenticated(
  request: CallableRequest
): asserts request is CallableRequest & {
  auth: NonNullable<CallableRequest["auth"]>
} {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    )
  }
}

function mapAuthType(provider?: string): Context["authType"] | undefined {
  if (!provider) return undefined
  if (provider === "password") return "password"
  if (provider === "custom") return "api"
  return "sso"
}

function buildContext(request: CallableRequest): Context | undefined {
  const raw = request.rawRequest
  const ip =
    (raw?.headers?.["x-forwarded-for"] as string | undefined) ??
    raw?.ip ??
    undefined
  const userAgent = raw?.headers?.["user-agent"] as string | undefined
  const authType = mapAuthType(request.auth?.token?.firebase?.sign_in_provider)

  const context: Context = {}
  if (ip) context.ip = ip
  if (userAgent) context.userAgent = userAgent
  if (authType) context.authType = authType

  return Object.keys(context).length > 0 ? context : undefined
}

function normalizeActor(actor: Actor): Actor {
  const normalized: Actor = { userId: actor.userId }
  if (actor.email) normalized.email = actor.email
  if (actor.role) normalized.role = actor.role
  return normalized
}

function normalizeChanges(changes?: Changes): Changes | undefined {
  if (!changes) return undefined
  const normalized: Changes = {}

  if (changes.before && Object.keys(changes.before).length > 0) {
    normalized.before = changes.before
  }
  if (changes.after && Object.keys(changes.after).length > 0) {
    normalized.after = changes.after
  }
  if (changes.fields && changes.fields.length > 0) {
    normalized.fields = changes.fields
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function buildChanges(
  before: Record<string, unknown>,
  updates: Record<string, unknown>
): Changes | undefined {
  const fields: string[] = []
  const beforeValues: Record<string, unknown> = {}
  const afterValues: Record<string, unknown> = {}

  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined) return
    const beforeValue = before[key]
    if (Object.is(beforeValue, value)) return
    fields.push(key)
    beforeValues[key] = beforeValue ?? null
    afterValues[key] = value
  })

  if (fields.length === 0) return undefined

  return {
    fields,
    before: beforeValues,
    after: afterValues,
  }
}

export async function logEvent(
  params: LogEventParams,
  options?: { transaction?: admin.firestore.Transaction }
): Promise<admin.firestore.DocumentReference> {
  const logRef = db.collection("logs").doc()
  const entry: LogEntry = {
    id: logRef.id,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    teamId: params.teamId,
    actor: normalizeActor(params.actor),
    action: params.action,
    resource: params.resource,
  }

  if (params.workspaceId) entry.workspaceId = params.workspaceId
  if (params.context) entry.context = params.context

  const normalizedChanges = normalizeChanges(params.changes)
  if (normalizedChanges) entry.changes = normalizedChanges

  if (options?.transaction) {
    options.transaction.set(logRef, entry)
    return logRef
  }

  await logRef.set(entry)
  return logRef
}

async function requireTeamRole(
  transaction: admin.firestore.Transaction,
  teamId: string,
  userId: string
): Promise<IMembershipRole> {
  const membershipRef = db.doc(`teams/${teamId}/memberships/${userId}`)
  const membershipSnap = await transaction.get(membershipRef)

  if (!membershipSnap.exists) {
    throw new HttpsError("permission-denied", "User is not a team member.")
  }

  const role = membershipSnap.data()?.role as IMembershipRole | undefined
  if (!role) {
    throw new HttpsError(
      "permission-denied",
      "Team membership role is missing."
    )
  }

  return role
}

function assertString(value: unknown, field: string): string {
  if (!value || typeof value !== "string") {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be a non-empty string.`
    )
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be a non-empty string.`
    )
  }
  return trimmed
}

// =============================================================================
// Team CRUD Operations
// =============================================================================

export const createTeam = onCall(async (request) => {
  assertAuthenticated(request)

  const name = assertString(request.data?.name, "name")
  const photoURL =
    typeof request.data?.photoURL === "string"
      ? request.data.photoURL.trim() || null
      : null

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  const teamRef = db.collection("teams").doc()
  const now = admin.firestore.FieldValue.serverTimestamp()

  const teamData = {
    id: teamRef.id,
    name,
    photoURL,
    createdAt: now,
    updatedAt: now,
  }

  // Create owner membership
  const membershipRef = db.doc(`teams/${teamRef.id}/memberships/${actorId}`)
  const userRef = db.doc(`users/${actorId}`)

  await db.runTransaction(async (transaction) => {
    // Get user data for membership
    const userSnap = await transaction.get(userRef)
    const userData = userSnap.exists
      ? userSnap.data()
      : {
          uid: actorId,
          email: actorEmail,
          displayName: request.auth.token.name ?? null,
          photoURL: request.auth.token.picture ?? null,
        }

    const membershipData = {
      userId: actorId,
      teamId: teamRef.id,
      role: "owner" as IMembershipRole,
      user: userData,
      team: teamData,
      createdAt: now,
      updatedAt: now,
    }

    transaction.set(teamRef, teamData)
    transaction.set(membershipRef, membershipData)

    // Update user's current team
    transaction.update(userRef, {
      currentTeamId: teamRef.id,
      updatedAt: now,
    })

    // Log the event
    await logEvent(
      {
        teamId: teamRef.id,
        actor: { userId: actorId, email: actorEmail, role: "owner" },
        action: "team.create",
        resource: { type: "team", id: teamRef.id },
        context: buildContext(request),
        changes: {
          fields: ["name", "photoURL"],
          after: { name, photoURL },
        },
      },
      { transaction }
    )
  })

  return {
    teamId: teamRef.id,
  }
})

export const updateTeam = onCall(async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const name =
    typeof request.data?.name === "string"
      ? request.data.name.trim()
      : undefined
  const photoURL =
    request.data?.photoURL === null
      ? null
      : typeof request.data?.photoURL === "string"
        ? request.data.photoURL.trim() || null
        : undefined

  const updates: Record<string, unknown> = {}
  if (name !== undefined) updates.name = name
  if (photoURL !== undefined) updates.photoURL = photoURL

  if (Object.keys(updates).length === 0) {
    throw new HttpsError(
      "invalid-argument",
      "At least one field must be provided for update."
    )
  }

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  return db.runTransaction(async (transaction) => {
    const role = await requireTeamRole(transaction, teamId, actorId)

    if (
      !can(actorId, Capabilities.EDIT_TEAM, {
        scope: "team",
        teamRole: role,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to update this team."
      )
    }

    const teamRef = db.doc(`teams/${teamId}`)
    const teamSnap = await transaction.get(teamRef)

    if (!teamSnap.exists) {
      throw new HttpsError("not-found", "Team not found.")
    }

    const before = teamSnap.data() ?? {}
    const changes = buildChanges(before, updates)

    if (!changes) {
      return { teamId, updated: false }
    }

    transaction.update(teamRef, {
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    // Also update team data in all memberships
    const membershipsSnap = await db
      .collection(`teams/${teamId}/memberships`)
      .get()
    membershipsSnap.docs.forEach((doc) => {
      transaction.update(doc.ref, {
        "team.name": updates.name ?? before.name,
        "team.photoURL": updates.photoURL ?? before.photoURL,
        "team.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
      })
    })

    const logRef = await logEvent(
      {
        teamId,
        actor: { userId: actorId, email: actorEmail, role },
        action: "team.update",
        resource: { type: "team", id: teamId },
        context: buildContext(request),
        changes,
      },
      { transaction }
    )

    return {
      teamId,
      updated: true,
      fields: changes.fields ?? [],
      logId: logRef.id,
    }
  })
})

export const deleteTeam = onCall(async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  // First verify role outside transaction
  const membershipRef = db.doc(`teams/${teamId}/memberships/${actorId}`)
  const membershipSnap = await membershipRef.get()

  if (!membershipSnap.exists) {
    throw new HttpsError("permission-denied", "User is not a team member.")
  }

  const role = membershipSnap.data()?.role as IMembershipRole
  if (
    !can(actorId, Capabilities.DELETE_TEAM, {
      scope: "team",
      teamRole: role,
    })
  ) {
    throw new HttpsError(
      "permission-denied",
      "You do not have permission to delete this team."
    )
  }

  // Get team data for logging
  const teamRef = db.doc(`teams/${teamId}`)
  const teamSnap = await teamRef.get()

  if (!teamSnap.exists) {
    throw new HttpsError("not-found", "Team not found.")
  }

  const teamData = teamSnap.data() ?? {}

  // Get all memberships and workspaces
  const [membershipsSnap, workspacesSnap] = await Promise.all([
    db.collection(`teams/${teamId}/memberships`).get(),
    db.collection(`teams/${teamId}/workspaces`).get(),
  ])

  // Batch delete all documents
  const batch = db.batch()

  // Delete workspaces
  workspacesSnap.docs.forEach((doc) => batch.delete(doc.ref))

  // Delete memberships (except actor's, delete last)
  const otherMemberships = membershipsSnap.docs.filter(
    (doc) => doc.id !== actorId
  )
  otherMemberships.forEach((doc) => batch.delete(doc.ref))

  // Delete team
  batch.delete(teamRef)

  // Delete actor's membership last
  batch.delete(membershipRef)

  // Update user's current team if needed
  const userRef = db.doc(`users/${actorId}`)
  const userSnap = await userRef.get()
  if (userSnap.exists && userSnap.data()?.currentTeamId === teamId) {
    batch.update(userRef, {
      currentTeamId: null,
      currentWorkspaceId: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  await batch.commit()

  // Log the event (outside transaction since team is deleted)
  await logEvent({
    teamId,
    actor: { userId: actorId, email: actorEmail, role },
    action: "team.delete",
    resource: { type: "team", id: teamId },
    context: buildContext(request),
    changes: {
      fields: ["name", "photoURL"],
      before: {
        name: teamData.name ?? null,
        photoURL: teamData.photoURL ?? null,
      },
    },
  })

  return {
    teamId,
    deleted: true,
  }
})

// =============================================================================
// Workspace CRUD Operations
// =============================================================================

export const createWorkspace = onCall(async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const name = assertString(request.data?.name, "name")
  const descriptionRaw = request.data?.description
  const description =
    typeof descriptionRaw === "string" ? descriptionRaw.trim() || null : null

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  return db.runTransaction(async (transaction) => {
    const role = await requireTeamRole(transaction, teamId, actorId)

    if (
      !can(actorId, Capabilities.CREATE_WORKSPACE, {
        scope: "team",
        teamRole: role,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to create workspaces."
      )
    }

    const workspaceRef = db.collection(`teams/${teamId}/workspaces`).doc()
    const now = admin.firestore.FieldValue.serverTimestamp()

    const workspaceData = {
      id: workspaceRef.id,
      teamId,
      name,
      description,
      photoURL: null,
      createdAt: now,
      updatedAt: now,
    }

    transaction.set(workspaceRef, workspaceData)

    const logRef = await logEvent(
      {
        teamId,
        workspaceId: workspaceRef.id,
        actor: { userId: actorId, email: actorEmail, role },
        action: "workspace.create",
        resource: { type: "workspace", id: workspaceRef.id, parentId: teamId },
        context: buildContext(request),
        changes: {
          fields: ["name", "description"],
          after: {
            name,
            description,
          },
        },
      },
      { transaction }
    )

    return {
      workspaceId: workspaceRef.id,
      logId: logRef.id,
    }
  })
})

export const updateWorkspace = onCall(async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const workspaceId = assertString(request.data?.workspaceId, "workspaceId")

  const name =
    typeof request.data?.name === "string"
      ? request.data.name.trim()
      : undefined
  const description =
    request.data?.description === null
      ? null
      : typeof request.data?.description === "string"
        ? request.data.description.trim() || null
        : undefined
  const photoURL =
    request.data?.photoURL === null
      ? null
      : typeof request.data?.photoURL === "string"
        ? request.data.photoURL.trim() || null
        : undefined

  const updates: Record<string, unknown> = {}
  if (name !== undefined) updates.name = name
  if (description !== undefined) updates.description = description
  if (photoURL !== undefined) updates.photoURL = photoURL

  if (Object.keys(updates).length === 0) {
    throw new HttpsError(
      "invalid-argument",
      "At least one field must be provided for update."
    )
  }

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  return db.runTransaction(async (transaction) => {
    const role = await requireTeamRole(transaction, teamId, actorId)

    if (
      !can(actorId, Capabilities.EDIT_WORKSPACE, {
        scope: "team",
        teamRole: role,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to update workspaces."
      )
    }

    const workspaceRef = db.doc(`teams/${teamId}/workspaces/${workspaceId}`)
    const workspaceSnap = await transaction.get(workspaceRef)

    if (!workspaceSnap.exists) {
      throw new HttpsError("not-found", "Workspace not found.")
    }

    const before = workspaceSnap.data() ?? {}
    const changes = buildChanges(before, updates)

    if (!changes) {
      return {
        workspaceId,
        updated: false,
      }
    }

    transaction.update(workspaceRef, {
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    const logRef = await logEvent(
      {
        teamId,
        workspaceId,
        actor: { userId: actorId, email: actorEmail, role },
        action: "workspace.update",
        resource: { type: "workspace", id: workspaceId, parentId: teamId },
        context: buildContext(request),
        changes,
      },
      { transaction }
    )

    return {
      workspaceId,
      updated: true,
      fields: changes.fields ?? [],
      logId: logRef.id,
    }
  })
})

export const deleteWorkspace = onCall(async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const workspaceId = assertString(request.data?.workspaceId, "workspaceId")

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  return db.runTransaction(async (transaction) => {
    const role = await requireTeamRole(transaction, teamId, actorId)

    if (
      !can(actorId, Capabilities.DELETE_WORKSPACE, {
        scope: "team",
        teamRole: role,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to delete workspaces."
      )
    }

    const workspaceRef = db.doc(`teams/${teamId}/workspaces/${workspaceId}`)
    const workspaceSnap = await transaction.get(workspaceRef)

    if (!workspaceSnap.exists) {
      throw new HttpsError("not-found", "Workspace not found.")
    }

    const workspaceData = workspaceSnap.data() ?? {}

    transaction.delete(workspaceRef)

    const logRef = await logEvent(
      {
        teamId,
        workspaceId,
        actor: { userId: actorId, email: actorEmail, role },
        action: "workspace.delete",
        resource: { type: "workspace", id: workspaceId, parentId: teamId },
        context: buildContext(request),
        changes: {
          fields: ["name", "description"],
          before: {
            name: workspaceData.name ?? null,
            description: workspaceData.description ?? null,
          },
        },
      },
      { transaction }
    )

    return {
      workspaceId,
      deleted: true,
      logId: logRef.id,
    }
  })
})

// =============================================================================
// Membership CRUD Operations
// =============================================================================

const validRoles: IMembershipRole[] = ["owner", "admin", "member", "guest"]

export const assignRoleToUser = onCall(async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const targetUserId = assertString(request.data?.userId, "userId")
  const role = assertString(request.data?.role, "role") as IMembershipRole

  if (!validRoles.includes(role)) {
    throw new HttpsError("invalid-argument", "Invalid role provided.")
  }

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  return db.runTransaction(async (transaction) => {
    const actorRole = await requireTeamRole(transaction, teamId, actorId)

    if (
      !can(actorId, Capabilities.UPDATE_MEMBER_ROLE, {
        scope: "team",
        teamRole: actorRole,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to change roles."
      )
    }

    const membershipRef = db.doc(`teams/${teamId}/memberships/${targetUserId}`)
    const membershipSnap = await transaction.get(membershipRef)

    if (!membershipSnap.exists) {
      throw new HttpsError("not-found", "Membership not found.")
    }

    const beforeRole = membershipSnap.data()?.role as
      | IMembershipRole
      | undefined

    if (!beforeRole) {
      throw new HttpsError(
        "failed-precondition",
        "Target membership role is missing."
      )
    }

    if (beforeRole === role) {
      return {
        teamId,
        userId: targetUserId,
        role,
        updated: false,
      }
    }

    // Check if changing from owner - must have at least one owner
    if (beforeRole === "owner" && role !== "owner") {
      const membershipsSnap = await db
        .collection(`teams/${teamId}/memberships`)
        .where("role", "==", "owner")
        .get()
      if (membershipsSnap.size <= 1) {
        throw new HttpsError(
          "failed-precondition",
          "Cannot change role: Team must have at least one owner."
        )
      }
    }

    transaction.update(membershipRef, {
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    const logRef = await logEvent(
      {
        teamId,
        actor: { userId: actorId, email: actorEmail, role: actorRole },
        action: "membership.role.update",
        resource: { type: "membership", id: targetUserId, parentId: teamId },
        context: buildContext(request),
        changes: {
          fields: ["role"],
          before: { role: beforeRole },
          after: { role },
        },
      },
      { transaction }
    )

    return {
      teamId,
      userId: targetUserId,
      role,
      updated: true,
      logId: logRef.id,
    }
  })
})

export const removeMember = onCall(async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const targetUserId = assertString(request.data?.userId, "userId")

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined
  const isRemovingSelf = actorId === targetUserId

  return db.runTransaction(async (transaction) => {
    const actorRole = await requireTeamRole(transaction, teamId, actorId)

    // If removing someone else, check permission
    if (!isRemovingSelf) {
      if (
        !can(actorId, Capabilities.REMOVE_MEMBER, {
          scope: "team",
          teamRole: actorRole,
        })
      ) {
        throw new HttpsError(
          "permission-denied",
          "You do not have permission to remove members."
        )
      }
    }

    const membershipRef = db.doc(`teams/${teamId}/memberships/${targetUserId}`)
    const membershipSnap = await transaction.get(membershipRef)

    if (!membershipSnap.exists) {
      throw new HttpsError("not-found", "Membership not found.")
    }

    const membershipData = membershipSnap.data()
    const targetRole = membershipData?.role as IMembershipRole
    const targetEmail = membershipData?.user?.email ?? undefined

    // Check if removing last owner
    if (targetRole === "owner") {
      const membershipsSnap = await db
        .collection(`teams/${teamId}/memberships`)
        .where("role", "==", "owner")
        .get()
      if (membershipsSnap.size <= 1) {
        throw new HttpsError(
          "failed-precondition",
          "Cannot remove the last owner. Assign another owner first."
        )
      }
    }

    // Check if removing last member
    const allMembershipsSnap = await db
      .collection(`teams/${teamId}/memberships`)
      .get()
    if (allMembershipsSnap.size <= 1) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot remove the last member. Delete the team instead."
      )
    }

    transaction.delete(membershipRef)

    // Update user's current team if removing self
    if (isRemovingSelf) {
      const userRef = db.doc(`users/${actorId}`)
      const userSnap = await transaction.get(userRef)
      if (userSnap.exists && userSnap.data()?.currentTeamId === teamId) {
        transaction.update(userRef, {
          currentTeamId: null,
          currentWorkspaceId: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      }
    }

    const logRef = await logEvent(
      {
        teamId,
        actor: { userId: actorId, email: actorEmail, role: actorRole },
        action: isRemovingSelf ? "membership.leave" : "membership.remove",
        resource: { type: "membership", id: targetUserId, parentId: teamId },
        context: buildContext(request),
        changes: {
          fields: ["userId", "role", "email"],
          before: {
            userId: targetUserId,
            role: targetRole,
            email: targetEmail,
          },
        },
      },
      { transaction }
    )

    return {
      teamId,
      userId: targetUserId,
      removed: true,
      logId: logRef.id,
    }
  })
})

export const removeMembers = onCall(async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const userIds = request.data?.userIds

  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new HttpsError(
      "invalid-argument",
      "userIds must be a non-empty array."
    )
  }

  // Validate all userIds are strings
  for (const id of userIds) {
    if (typeof id !== "string" || !id.trim()) {
      throw new HttpsError("invalid-argument", "All userIds must be strings.")
    }
  }

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined
  const isRemovingSelf = userIds.includes(actorId)

  return db.runTransaction(async (transaction) => {
    const actorRole = await requireTeamRole(transaction, teamId, actorId)

    // Check permission (must have permission to remove others)
    const removingOthers = userIds.some((id) => id !== actorId)
    if (removingOthers) {
      if (
        !can(actorId, Capabilities.REMOVE_MEMBER, {
          scope: "team",
          teamRole: actorRole,
        })
      ) {
        throw new HttpsError(
          "permission-denied",
          "You do not have permission to remove members."
        )
      }
    }

    // Get all memberships being removed
    const membershipRefs = userIds.map((userId) =>
      db.doc(`teams/${teamId}/memberships/${userId}`)
    )
    const membershipSnaps = await Promise.all(
      membershipRefs.map((ref) => transaction.get(ref))
    )

    const membershipsToRemove: Array<{
      userId: string
      role: IMembershipRole
      email?: string
    }> = []

    for (let i = 0; i < membershipSnaps.length; i++) {
      const snap = membershipSnaps[i]
      if (!snap || !snap.exists) {
        throw new HttpsError(
          "not-found",
          `Membership not found for user ${userIds[i]}.`
        )
      }
      const data = snap.data()
      membershipsToRemove.push({
        userId: userIds[i],
        role: data?.role as IMembershipRole,
        email: data?.user?.email,
      })
    }

    // Get all memberships to check constraints
    const allMembershipsSnap = await db
      .collection(`teams/${teamId}/memberships`)
      .get()

    const userIdSet = new Set(userIds)
    const remainingMembers = allMembershipsSnap.docs.filter(
      (doc) => !userIdSet.has(doc.id)
    )

    if (remainingMembers.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot remove all members. Delete the team instead."
      )
    }

    const remainingOwners = remainingMembers.filter(
      (doc) => doc.data().role === "owner"
    )
    if (remainingOwners.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot remove all owners. Assign another owner first."
      )
    }

    // Delete all memberships
    membershipRefs.forEach((ref) => transaction.delete(ref))

    // Update user's current team if removing self
    if (isRemovingSelf) {
      const userRef = db.doc(`users/${actorId}`)
      const userSnap = await transaction.get(userRef)
      if (userSnap.exists && userSnap.data()?.currentTeamId === teamId) {
        transaction.update(userRef, {
          currentTeamId: null,
          currentWorkspaceId: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      }
    }

    // Log for each removed member
    const logIds: string[] = []
    for (const member of membershipsToRemove) {
      const logRef = await logEvent(
        {
          teamId,
          actor: { userId: actorId, email: actorEmail, role: actorRole },
          action:
            member.userId === actorId
              ? "membership.leave"
              : "membership.remove",
          resource: { type: "membership", id: member.userId, parentId: teamId },
          context: buildContext(request),
          changes: {
            fields: ["userId", "role", "email"],
            before: {
              userId: member.userId,
              role: member.role,
              email: member.email,
            },
          },
        },
        { transaction }
      )
      logIds.push(logRef.id)
    }

    return {
      teamId,
      userIds,
      removed: true,
      count: userIds.length,
      logIds,
    }
  })
})
