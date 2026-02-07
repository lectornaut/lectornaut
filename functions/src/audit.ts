import admin from "firebase-admin"
import {
  CallableRequest,
  HttpsError,
  onCall,
} from "firebase-functions/v2/https"
import { can } from "./permissions.js"
import {
  Actor,
  Capabilities,
  Changes,
  Context,
  IMembershipRole,
  InvitationData,
  LogEntry,
  LogEventParams,
  NodeType,
  WorkspaceNodeScope,
} from "./types.js"

if (!admin.apps.length) {
  admin.initializeApp()
}

const db = admin.firestore()

// =============================================================================
// Audit Log Types
// =============================================================================

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

async function getTeamRole(
  teamId: string,
  userId: string
): Promise<IMembershipRole> {
  const membershipRef = db.doc(`teams/${teamId}/memberships/${userId}`)
  const membershipSnap = await membershipRef.get()

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

const ROOT_PARENT_ID = "root"
const NODE_NAME_MAX_LENGTH = 128

function normalizeNodeName(name: string): string {
  return name.trim().replace(/\s+/g, " ")
}

function toNameLower(name: string): string {
  return normalizeNodeName(name).toLowerCase()
}

function getTypeOrder(type: NodeType): number {
  return type === "folder" ? 0 : 1
}

function assertNodeType(value: unknown): NodeType {
  if (value !== "folder" && value !== "file") {
    throw new HttpsError("invalid-argument", "type must be folder or file.")
  }
  return value
}

function assertWorkspaceNodeScope(value: unknown): WorkspaceNodeScope {
  if (value !== "code" && value !== "write") {
    throw new HttpsError(
      "invalid-argument",
      "scope must be either code or write."
    )
  }
  return value
}

function assertNodeName(value: unknown, field: string): string {
  const normalized = normalizeNodeName(assertString(value, field))
  if (!normalized.length || normalized.length > NODE_NAME_MAX_LENGTH) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be between 1 and ${NODE_NAME_MAX_LENGTH} characters.`
    )
  }
  return normalized
}

function workspaceNodesCollectionPath(
  teamId: string,
  workspaceId: string,
  scope: WorkspaceNodeScope
): string {
  return `teams/${teamId}/workspaces/${workspaceId}/${scope}`
}

const IN_QUERY_CHUNK_SIZE = 10
const DELETE_BATCH_SIZE = 450

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items]

  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
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
// Workspace Node Operations
// =============================================================================

export const createWorkspaceNode = onCall(async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const workspaceId = assertString(request.data?.workspaceId, "workspaceId")
  const scope = assertWorkspaceNodeScope(request.data?.scope)
  const parentIdRaw = request.data?.parentId
  const parentId =
    typeof parentIdRaw === "string" && parentIdRaw.trim()
      ? parentIdRaw.trim()
      : ROOT_PARENT_ID
  const name = assertNodeName(request.data?.name, "name")
  const type = assertNodeType(request.data?.type)

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  return db.runTransaction(async (transaction) => {
    const role = await requireTeamRole(transaction, teamId, actorId)

    if (
      !can(actorId, Capabilities.MANAGE_WORKSPACE_CONTENT, {
        scope: "workspace",
        teamRole: role,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to manage workspace content."
      )
    }

    const workspaceRef = db.doc(`teams/${teamId}/workspaces/${workspaceId}`)
    const workspaceSnap = await transaction.get(workspaceRef)
    if (!workspaceSnap.exists) {
      throw new HttpsError("not-found", "Workspace not found.")
    }

    if (parentId !== ROOT_PARENT_ID) {
      const parentRef = db.doc(
        `${workspaceNodesCollectionPath(teamId, workspaceId, scope)}/${parentId}`
      )
      const parentSnap = await transaction.get(parentRef)
      if (!parentSnap.exists) {
        throw new HttpsError("not-found", "Parent folder not found.")
      }
      const parentData = parentSnap.data() ?? {}
      if (parentData.type !== "folder") {
        throw new HttpsError("failed-precondition", "Parent must be a folder.")
      }
      if (parentData.isArchived) {
        throw new HttpsError(
          "failed-precondition",
          "Parent folder is archived."
        )
      }
    }

    const nodeRef = db
      .collection(workspaceNodesCollectionPath(teamId, workspaceId, scope))
      .doc()
    const now = admin.firestore.FieldValue.serverTimestamp()
    const nameLower = toNameLower(name)

    const nodeData = {
      workspaceId,
      type,
      typeOrder: getTypeOrder(type),
      name,
      nameLower,
      parentId,
      isArchived: false,
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
      sortKey: nameLower,
      ...(type === "file" ? { content: "" } : {}),
    }

    transaction.set(nodeRef, nodeData)

    const logRef = await logEvent(
      {
        teamId,
        workspaceId,
        actor: { userId: actorId, email: actorEmail, role },
        action: "content.create",
        resource: { type: "content", id: nodeRef.id, parentId: workspaceId },
        context: buildContext(request),
        changes: {
          fields: ["name", "type", "parentId"],
          after: {
            name,
            type,
            parentId,
          },
        },
      },
      { transaction }
    )

    return {
      nodeId: nodeRef.id,
      logId: logRef.id,
    }
  })
})

export const renameWorkspaceNode = onCall(async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const workspaceId = assertString(request.data?.workspaceId, "workspaceId")
  const scope = assertWorkspaceNodeScope(request.data?.scope)
  const nodeId = assertString(request.data?.nodeId, "nodeId")
  const name = assertNodeName(request.data?.name, "name")

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  return db.runTransaction(async (transaction) => {
    const role = await requireTeamRole(transaction, teamId, actorId)

    if (
      !can(actorId, Capabilities.MANAGE_WORKSPACE_CONTENT, {
        scope: "workspace",
        teamRole: role,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to manage workspace content."
      )
    }

    const nodeRef = db.doc(
      `${workspaceNodesCollectionPath(teamId, workspaceId, scope)}/${nodeId}`
    )
    const nodeSnap = await transaction.get(nodeRef)
    if (!nodeSnap.exists) {
      throw new HttpsError("not-found", "Node not found.")
    }

    const before = nodeSnap.data() ?? {}
    if (before.isArchived) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot rename an archived node."
      )
    }

    const nameLower = toNameLower(name)
    const now = admin.firestore.FieldValue.serverTimestamp()

    transaction.update(nodeRef, {
      name,
      nameLower,
      sortKey: nameLower,
      updatedAt: now,
      updatedBy: actorId,
    })

    const changes = buildChanges(before, { name })
    const logRef = await logEvent(
      {
        teamId,
        workspaceId,
        actor: { userId: actorId, email: actorEmail, role },
        action: "content.rename",
        resource: { type: "content", id: nodeId, parentId: workspaceId },
        context: buildContext(request),
        changes,
      },
      { transaction }
    )

    return {
      nodeId,
      updated: true,
      logId: logRef.id,
    }
  })
})

export const moveWorkspaceNode = onCall(async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const workspaceId = assertString(request.data?.workspaceId, "workspaceId")
  const scope = assertWorkspaceNodeScope(request.data?.scope)
  const nodeId = assertString(request.data?.nodeId, "nodeId")
  const parentIdRaw = request.data?.parentId
  const parentId =
    typeof parentIdRaw === "string" && parentIdRaw.trim()
      ? parentIdRaw.trim()
      : ROOT_PARENT_ID

  if (nodeId === parentId) {
    throw new HttpsError("invalid-argument", "A node cannot be its own parent.")
  }

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  return db.runTransaction(async (transaction) => {
    const role = await requireTeamRole(transaction, teamId, actorId)

    if (
      !can(actorId, Capabilities.MANAGE_WORKSPACE_CONTENT, {
        scope: "workspace",
        teamRole: role,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to manage workspace content."
      )
    }

    const nodeRef = db.doc(
      `${workspaceNodesCollectionPath(teamId, workspaceId, scope)}/${nodeId}`
    )
    const nodeSnap = await transaction.get(nodeRef)
    if (!nodeSnap.exists) {
      throw new HttpsError("not-found", "Node not found.")
    }

    const before = nodeSnap.data() ?? {}
    if (before.isArchived) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot move an archived node."
      )
    }

    if (parentId !== ROOT_PARENT_ID) {
      const parentRef = db.doc(
        `${workspaceNodesCollectionPath(teamId, workspaceId, scope)}/${parentId}`
      )
      const parentSnap = await transaction.get(parentRef)
      if (!parentSnap.exists) {
        throw new HttpsError("not-found", "Parent folder not found.")
      }
      const parentData = parentSnap.data() ?? {}
      if (parentData.type !== "folder") {
        throw new HttpsError("failed-precondition", "Parent must be a folder.")
      }
      if (parentData.isArchived) {
        throw new HttpsError(
          "failed-precondition",
          "Parent folder is archived."
        )
      }
    }

    const now = admin.firestore.FieldValue.serverTimestamp()
    transaction.update(nodeRef, {
      parentId,
      updatedAt: now,
      updatedBy: actorId,
    })

    const changes = buildChanges(before, { parentId })
    const logRef = await logEvent(
      {
        teamId,
        workspaceId,
        actor: { userId: actorId, email: actorEmail, role },
        action: "content.move",
        resource: { type: "content", id: nodeId, parentId: workspaceId },
        context: buildContext(request),
        changes,
      },
      { transaction }
    )

    return {
      nodeId,
      updated: true,
      logId: logRef.id,
    }
  })
})

export const archiveWorkspaceNode = onCall(async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const workspaceId = assertString(request.data?.workspaceId, "workspaceId")
  const scope = assertWorkspaceNodeScope(request.data?.scope)
  const nodeId = assertString(request.data?.nodeId, "nodeId")

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  return db.runTransaction(async (transaction) => {
    const role = await requireTeamRole(transaction, teamId, actorId)

    if (
      !can(actorId, Capabilities.MANAGE_WORKSPACE_CONTENT, {
        scope: "workspace",
        teamRole: role,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to manage workspace content."
      )
    }

    const nodeRef = db.doc(
      `${workspaceNodesCollectionPath(teamId, workspaceId, scope)}/${nodeId}`
    )
    const nodeSnap = await transaction.get(nodeRef)
    if (!nodeSnap.exists) {
      throw new HttpsError("not-found", "Node not found.")
    }

    const before = nodeSnap.data() ?? {}
    if (before.isArchived) {
      throw new HttpsError("failed-precondition", "Node is already archived.")
    }

    const now = admin.firestore.FieldValue.serverTimestamp()
    transaction.update(nodeRef, {
      isArchived: true,
      archivedAt: now,
      archivedBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
    })

    const changes = buildChanges(before, { isArchived: true })
    const logRef = await logEvent(
      {
        teamId,
        workspaceId,
        actor: { userId: actorId, email: actorEmail, role },
        action: "content.archive",
        resource: { type: "content", id: nodeId, parentId: workspaceId },
        context: buildContext(request),
        changes,
      },
      { transaction }
    )

    return {
      nodeId,
      archived: true,
      logId: logRef.id,
    }
  })
})

export const unarchiveWorkspaceNode = onCall(async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const workspaceId = assertString(request.data?.workspaceId, "workspaceId")
  const scope = assertWorkspaceNodeScope(request.data?.scope)
  const nodeId = assertString(request.data?.nodeId, "nodeId")

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  return db.runTransaction(async (transaction) => {
    const role = await requireTeamRole(transaction, teamId, actorId)

    if (
      !can(actorId, Capabilities.MANAGE_WORKSPACE_CONTENT, {
        scope: "workspace",
        teamRole: role,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to manage workspace content."
      )
    }

    const nodeRef = db.doc(
      `${workspaceNodesCollectionPath(teamId, workspaceId, scope)}/${nodeId}`
    )
    const nodeSnap = await transaction.get(nodeRef)
    if (!nodeSnap.exists) {
      throw new HttpsError("not-found", "Node not found.")
    }

    const before = nodeSnap.data() ?? {}
    if (!before.isArchived) {
      throw new HttpsError("failed-precondition", "Node is not archived.")
    }

    const now = admin.firestore.FieldValue.serverTimestamp()
    transaction.update(nodeRef, {
      isArchived: false,
      archivedAt: admin.firestore.FieldValue.delete(),
      archivedBy: admin.firestore.FieldValue.delete(),
      updatedAt: now,
      updatedBy: actorId,
    })

    const changes = buildChanges(before, { isArchived: false })
    const logRef = await logEvent(
      {
        teamId,
        workspaceId,
        actor: { userId: actorId, email: actorEmail, role },
        action: "content.unarchive",
        resource: { type: "content", id: nodeId, parentId: workspaceId },
        context: buildContext(request),
        changes,
      },
      { transaction }
    )

    return {
      nodeId,
      unarchived: true,
      logId: logRef.id,
    }
  })
})

export const deleteWorkspaceNode = onCall(async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const workspaceId = assertString(request.data?.workspaceId, "workspaceId")
  const scope = assertWorkspaceNodeScope(request.data?.scope)
  const nodeId = assertString(request.data?.nodeId, "nodeId")

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined
  const role = await getTeamRole(teamId, actorId)

  if (
    !can(actorId, Capabilities.MANAGE_WORKSPACE_CONTENT, {
      scope: "workspace",
      teamRole: role,
    })
  ) {
    throw new HttpsError(
      "permission-denied",
      "You do not have permission to manage workspace content."
    )
  }

  const nodesCollection = db.collection(
    workspaceNodesCollectionPath(teamId, workspaceId, scope)
  )
  const nodeRef = nodesCollection.doc(nodeId)
  const nodeSnap = await nodeRef.get()

  if (!nodeSnap.exists) {
    throw new HttpsError("not-found", "Node not found.")
  }

  const before = nodeSnap.data() ?? {}
  if (!before.isArchived) {
    throw new HttpsError(
      "failed-precondition",
      "Node must be archived before permanent deletion."
    )
  }

  const idsToDelete = new Set<string>([nodeId])
  const queue: string[] = [nodeId]

  while (queue.length) {
    const parentIds = queue.splice(0, IN_QUERY_CHUNK_SIZE)
    const descendantsSnap = await nodesCollection
      .where("parentId", "in", parentIds)
      .get()

    descendantsSnap.docs.forEach((docSnap) => {
      if (idsToDelete.has(docSnap.id)) return
      idsToDelete.add(docSnap.id)
      queue.push(docSnap.id)
    })
  }

  const deleteIds = [...idsToDelete]
  const batches = chunkArray(deleteIds, DELETE_BATCH_SIZE)
  for (const batchIds of batches) {
    const batch = db.batch()
    batchIds.forEach((id) => {
      batch.delete(nodesCollection.doc(id))
    })
    await batch.commit()
  }

  const logRef = await logEvent({
    teamId,
    workspaceId,
    actor: { userId: actorId, email: actorEmail, role },
    action: "content.delete",
    resource: { type: "content", id: nodeId, parentId: workspaceId },
    context: buildContext(request),
    changes: {
      fields: ["deleted", "deletedCount"],
      before: {
        name: before.name ?? null,
        isArchived: before.isArchived ?? false,
      },
      after: {
        deleted: true,
        deletedCount: deleteIds.length,
      },
    },
  })

  return {
    nodeId,
    deleted: true,
    deletedCount: deleteIds.length,
    logId: logRef.id,
  }
})

export const updateWorkspaceNodeContent = onCall(async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const workspaceId = assertString(request.data?.workspaceId, "workspaceId")
  const scope = assertWorkspaceNodeScope(request.data?.scope)
  const nodeId = assertString(request.data?.nodeId, "nodeId")
  const contentRaw = request.data?.content
  const content = typeof contentRaw === "string" ? contentRaw : ""

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  return db.runTransaction(async (transaction) => {
    const role = await requireTeamRole(transaction, teamId, actorId)

    if (
      !can(actorId, Capabilities.MANAGE_WORKSPACE_CONTENT, {
        scope: "workspace",
        teamRole: role,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to manage workspace content."
      )
    }

    const nodeRef = db.doc(
      `${workspaceNodesCollectionPath(teamId, workspaceId, scope)}/${nodeId}`
    )
    const nodeSnap = await transaction.get(nodeRef)
    if (!nodeSnap.exists) {
      throw new HttpsError("not-found", "Node not found.")
    }

    const before = nodeSnap.data() ?? {}
    if (before.type !== "file") {
      throw new HttpsError("failed-precondition", "Only files can be updated.")
    }
    if (before.isArchived) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot edit an archived file."
      )
    }

    const now = admin.firestore.FieldValue.serverTimestamp()
    transaction.update(nodeRef, {
      content,
      updatedAt: now,
      updatedBy: actorId,
    })

    const logRef = await logEvent(
      {
        teamId,
        workspaceId,
        actor: { userId: actorId, email: actorEmail, role },
        action: "content.update",
        resource: { type: "content", id: nodeId, parentId: workspaceId },
        context: buildContext(request),
        changes: {
          fields: ["content"],
        },
      },
      { transaction }
    )

    return {
      nodeId,
      updated: true,
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

// =============================================================================
// Invitation Operations
// =============================================================================

/**
 * Send a new invitation to join a team.
 */
export const sendInvitation = onCall(async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const email = assertString(request.data?.email, "email").toLowerCase()
  const role = assertString(request.data?.role, "role") as IMembershipRole

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  // 1. Check Permissions
  const actorRole = await getTeamRole(teamId, actorId)
  if (
    !can(actorId, Capabilities.INVITE_MEMBER, {
      scope: "team",
      teamRole: actorRole,
    })
  ) {
    throw new HttpsError(
      "permission-denied",
      "You do not have permission to invite members."
    )
  }

  // 2. Check if user is already a member
  // querying by email to find userId
  const usersRef = db.collection("users")
  const userQuery = await usersRef.where("email", "==", email).get()

  if (!userQuery.empty) {
    const targetUserId = userQuery.docs[0].id
    const membershipRef = db.doc(`teams/${teamId}/memberships/${targetUserId}`)
    const membershipSnap = await membershipRef.get()

    if (membershipSnap.exists) {
      throw new HttpsError(
        "already-exists",
        "User is already a member of this team."
      )
    }
  }

  // 3. Check for existing pending invitation
  const invitationsRef = db.collection("invitations")
  const existingInvites = await invitationsRef
    .where("teamId", "==", teamId)
    .where("email", "==", email)
    .where("status", "==", "pending")
    .get()

  if (!existingInvites.empty) {
    throw new HttpsError(
      "already-exists",
      "A pending invitation already exists for this email."
    )
  }

  // 4. Create Invitation
  const teamRef = db.doc(`teams/${teamId}`)
  const teamSnap = await teamRef.get()
  if (!teamSnap.exists) {
    throw new HttpsError("not-found", "Team not found.")
  }
  const teamName = teamSnap.data()?.name || "Team"

  const inviterName =
    request.auth.token.name || request.auth.token.email || "Someone"

  const code = Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  const now = admin.firestore.FieldValue.serverTimestamp()
  const invitationRef = invitationsRef.doc()

  const invitationData: InvitationData = {
    teamId,
    teamName,
    inviterName,
    inviterEmail: actorEmail || "",
    email,
    role,
    status: "pending",
    code,
    createdAt: now,
  }

  await invitationRef.set(invitationData)

  // 5. Audit Log
  // Using 'content' type as invitation is a content-like resource in this context, or maybe 'membership' related
  await logEvent({
    teamId,
    actor: { userId: actorId, email: actorEmail, role: actorRole },
    action: "invitation.create",
    resource: { type: "membership", id: invitationRef.id, parentId: teamId }, // It leads to membership
    context: buildContext(request),
    changes: {
      after: { email, role, code },
    },
  })

  return { invitationId: invitationRef.id }
})

/**
 * Resend an existing invitation.
 */
export const resendInvitation = onCall(async (request) => {
  assertAuthenticated(request)

  const invitationId = assertString(request.data?.invitationId, "invitationId")
  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  const invRef = db.doc(`invitations/${invitationId}`)
  const invSnap = await invRef.get()

  if (!invSnap.exists) {
    throw new HttpsError("not-found", "Invitation not found.")
  }

  const invitation = invSnap.data() as InvitationData
  const teamId = invitation.teamId

  // Check Permissions
  const actorRole = await getTeamRole(teamId, actorId)
  if (
    !can(actorId, Capabilities.INVITE_MEMBER, {
      scope: "team",
      teamRole: actorRole,
    })
  ) {
    throw new HttpsError(
      "permission-denied",
      "You do not have permission to resend invitations."
    )
  }

  // Update invitation
  await invRef.update({
    resentAt: admin.firestore.FieldValue.serverTimestamp(),
    status: "pending", // Reset status if it was declined? Usually yes.
  })

  // Audit Log
  await logEvent({
    teamId,
    actor: { userId: actorId, email: actorEmail, role: actorRole },
    action: "invitation.resend",
    resource: { type: "membership", id: invitationId, parentId: teamId },
    context: buildContext(request),
  })

  return { success: true }
})

/**
 * Update the role of a pending invitation.
 */
export const updateInvitationRole = onCall(async (request) => {
  assertAuthenticated(request)

  const invitationId = assertString(request.data?.invitationId, "invitationId")
  const role = assertString(request.data?.role, "role") as IMembershipRole

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  const invRef = db.doc(`invitations/${invitationId}`)

  return db.runTransaction(async (transaction) => {
    const invSnap = await transaction.get(invRef)
    if (!invSnap.exists) {
      throw new HttpsError("not-found", "Invitation not found.")
    }
    const invitation = invSnap.data() as InvitationData
    const teamId = invitation.teamId

    // Check Permissions
    const actorRole = await requireTeamRole(transaction, teamId, actorId)
    // Using UPDATE_MEMBER_ROLE capability as proxy for updating invitation role
    if (
      !can(actorId, Capabilities.UPDATE_MEMBER_ROLE, {
        scope: "team",
        teamRole: actorRole,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to update invitations."
      )
    }

    transaction.update(invRef, { role })

    await logEvent(
      {
        teamId,
        actor: { userId: actorId, email: actorEmail, role: actorRole },
        action: "invitation.update",
        resource: { type: "membership", id: invitationId, parentId: teamId },
        context: buildContext(request),
        changes: {
          before: { role: invitation.role },
          after: { role },
        },
      },
      { transaction }
    )
  })
})

/**
 * Cancel/Delete an invitation.
 */
export const cancelInvitation = onCall(async (request) => {
  assertAuthenticated(request)

  const invitationId = assertString(request.data?.invitationId, "invitationId")
  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  const invRef = db.doc(`invitations/${invitationId}`)

  return db.runTransaction(async (transaction) => {
    const invSnap = await transaction.get(invRef)
    if (!invSnap.exists) {
      throw new HttpsError("not-found", "Invitation not found.")
    }
    const invitation = invSnap.data() as InvitationData
    const teamId = invitation.teamId

    // Check Permissions
    const actorRole = await requireTeamRole(transaction, teamId, actorId)
    if (
      !can(actorId, Capabilities.INVITE_MEMBER, {
        scope: "team",
        teamRole: actorRole,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to delete invitations."
      )
    }

    transaction.delete(invRef)

    await logEvent(
      {
        teamId,
        actor: { userId: actorId, email: actorEmail, role: actorRole },
        action: "invitation.delete",
        resource: { type: "membership", id: invitationId, parentId: teamId },
        context: buildContext(request),
        changes: {
          before: { email: invitation.email, role: invitation.role },
        },
      },
      { transaction }
    )
  })
})

/**
 * Decline an invitation (called by the user who was invited).
 */
export const declineInvitation = onCall(async (request) => {
  assertAuthenticated(request)

  const invitationId = assertString(request.data?.invitationId, "invitationId")
  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email

  const invRef = db.doc(`invitations/${invitationId}`)

  return db.runTransaction(async (transaction) => {
    const invSnap = await transaction.get(invRef)
    if (!invSnap.exists) {
      throw new HttpsError("not-found", "Invitation not found.")
    }
    const invitation = invSnap.data() as InvitationData

    // Verify the user declining is the one invited
    if (invitation.email !== actorEmail) {
      throw new HttpsError(
        "permission-denied",
        "This invitation is not for you."
      )
    }

    transaction.update(invRef, { status: "declined" })

    // No audit log needed for decline? Or maybe yes.
    // We'll log it as a membership event
    await logEvent(
      {
        teamId: invitation.teamId,
        actor: { userId: actorId, email: actorEmail ?? undefined },
        action: "invitation.decline",
        resource: {
          type: "membership",
          id: invitationId,
          parentId: invitation.teamId,
        },
        context: buildContext(request),
      },
      { transaction }
    )
  })
})
