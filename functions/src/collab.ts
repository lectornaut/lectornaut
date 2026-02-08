import admin from "firebase-admin"
import {
  CallableRequest,
  HttpsError,
  onCall,
} from "firebase-functions/v2/https"
import { onSchedule } from "firebase-functions/v2/scheduler"
import { randomUUID } from "node:crypto"
import { can } from "./permissions.js"
import { Capabilities, IMembershipRole, WorkspaceNodeScope } from "./types.js"

if (!admin.apps.length) {
  admin.initializeApp()
}

const db = admin.firestore()

const JOIN_TOKEN_TTL_MS = 10 * 60 * 1000
const STALE_SIGNAL_MAX_AGE_MS = 30 * 60 * 1000 // 30 minutes - signals are cleaned by clients, this is fallback
const STALE_PEER_MAX_AGE_MS = 10 * 60 * 1000 // 10 minutes - accounts for missed heartbeats
const CLEANUP_BATCH_SIZE = 500 // Firestore batch limit

type CollabRole = "editor" | "viewer"
type SignalType = "offer" | "answer" | "ice"

interface RoomContext {
  contentId: string
  teamId: string
  workspaceId: string
  scope: WorkspaceNodeScope
  roomRef: admin.firestore.DocumentReference
}

interface PeerSession {
  peerId: string
  userId: string
  joinToken: string
  tokenExpiresAt: number
}

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

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${field} must be a string.`)
  }

  const trimmed = value.trim()
  if (!trimmed.length) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be a non-empty string.`
    )
  }

  return trimmed
}

function assertStringArray(
  value: unknown,
  field: string,
  options: { maxLength: number }
): string[] {
  if (!Array.isArray(value)) {
    throw new HttpsError("invalid-argument", `${field} must be an array.`)
  }

  if (!value.length) {
    return []
  }

  if (value.length > options.maxLength) {
    throw new HttpsError(
      "invalid-argument",
      `${field} cannot contain more than ${options.maxLength} items.`
    )
  }

  return value.map((entry, index) => {
    return assertString(entry, `${field}[${index}]`)
  })
}

function sanitizeDisplayName(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback
  }

  const normalized = value.trim()
  if (!normalized.length) {
    return fallback
  }

  return normalized.slice(0, 80)
}

function sanitizeColor(value: unknown): string {
  const fallback = "#6366f1"
  if (typeof value !== "string") {
    return fallback
  }

  const normalized = value.trim()
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : fallback
}

function isMembershipRole(value: unknown): value is IMembershipRole {
  return (
    value === "owner" ||
    value === "admin" ||
    value === "member" ||
    value === "guest"
  )
}

function assertSignalType(value: unknown): SignalType {
  if (value !== "offer" && value !== "answer" && value !== "ice") {
    throw new HttpsError(
      "invalid-argument",
      "type must be one of offer, answer, ice."
    )
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

function mintJoinToken(): string {
  return `${Date.now().toString(36)}.${randomUUID().replace(/-/g, "")}`
}

async function ensureContentExists(
  contentId: string,
  teamId: string,
  workspaceId: string,
  scope: WorkspaceNodeScope
): Promise<void> {
  const contentRef = db.doc(
    `teams/${teamId}/workspaces/${workspaceId}/${scope}/${contentId}`
  )

  const contentSnap = await contentRef.get()
  if (!contentSnap.exists) {
    throw new HttpsError("not-found", "Content document not found.")
  }
}

async function resolveRole(
  userId: string,
  teamId: string,
  workspaceId: string
): Promise<IMembershipRole> {
  const workspaceMemberRef = db.doc(
    `teams/${teamId}/workspaces/${workspaceId}/memberships/${userId}`
  )
  const workspaceMemberSnap = await workspaceMemberRef.get()

  if (workspaceMemberSnap.exists) {
    const role = workspaceMemberSnap.data()?.role
    if (isMembershipRole(role)) {
      return role
    }
  }

  const teamMemberRef = db.doc(`teams/${teamId}/memberships/${userId}`)
  const teamMemberSnap = await teamMemberRef.get()

  if (!teamMemberSnap.exists) {
    throw new HttpsError("permission-denied", "You are not a team member.")
  }

  const role = teamMemberSnap.data()?.role
  if (!isMembershipRole(role)) {
    throw new HttpsError(
      "permission-denied",
      "Membership role is missing or invalid."
    )
  }

  return role
}

function resolveCollabRole(userId: string, role: IMembershipRole): CollabRole {
  return can(userId, Capabilities.MANAGE_WORKSPACE_CONTENT, {
    scope: "workspace",
    teamRole: role,
  })
    ? "editor"
    : "viewer"
}

function assertCanViewWorkspace(userId: string, role: IMembershipRole): void {
  const allowed = can(userId, Capabilities.READ_WORKSPACE, {
    scope: "workspace",
    teamRole: role,
  })

  if (!allowed) {
    throw new HttpsError(
      "permission-denied",
      "You do not have access to this workspace."
    )
  }
}

async function getRoomContext(contentId: string): Promise<RoomContext> {
  const roomRef = db.doc(`signaling/${contentId}`)
  const roomSnap = await roomRef.get()

  if (!roomSnap.exists) {
    throw new HttpsError(
      "failed-precondition",
      "Collaboration room not initialized. Call joinCollabRoom first."
    )
  }

  const data = roomSnap.data() as {
    teamId?: unknown
    workspaceId?: unknown
    contentId?: unknown
    scope?: unknown
  }

  if (
    typeof data.teamId !== "string" ||
    typeof data.workspaceId !== "string" ||
    typeof data.contentId !== "string" ||
    (data.scope !== "code" && data.scope !== "write")
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Collaboration room metadata is invalid."
    )
  }

  return {
    roomRef,
    contentId: data.contentId,
    teamId: data.teamId,
    workspaceId: data.workspaceId,
    scope: data.scope,
  }
}

async function getPeerSession(
  contentId: string,
  peerId: string
): Promise<{
  peerRef: admin.firestore.DocumentReference
  data: PeerSession
}> {
  const peerRef = db.doc(`signaling/${contentId}/peers/${peerId}`)
  const peerSnap = await peerRef.get()

  if (!peerSnap.exists) {
    throw new HttpsError("not-found", "Peer does not exist.")
  }

  const data = peerSnap.data() as Partial<PeerSession>
  if (
    typeof data.peerId !== "string" ||
    typeof data.userId !== "string" ||
    typeof data.joinToken !== "string" ||
    typeof data.tokenExpiresAt !== "number"
  ) {
    throw new HttpsError("failed-precondition", "Peer session is invalid.")
  }

  return {
    peerRef,
    data: {
      peerId: data.peerId,
      userId: data.userId,
      joinToken: data.joinToken,
      tokenExpiresAt: data.tokenExpiresAt,
    },
  }
}

function assertPeerOwnership(
  peer: PeerSession,
  uid: string,
  joinToken: string,
  options: { requireUnexpiredToken: boolean }
): void {
  if (peer.userId !== uid) {
    throw new HttpsError(
      "permission-denied",
      "You can only use your own peer session."
    )
  }

  if (peer.joinToken !== joinToken) {
    throw new HttpsError("permission-denied", "Invalid join token.")
  }

  if (options.requireUnexpiredToken && peer.tokenExpiresAt < Date.now()) {
    throw new HttpsError(
      "permission-denied",
      "Join token expired. Rejoin the collaboration room."
    )
  }
}

async function cleanupCollectionGroup(
  collectionId: "signals" | "peers",
  field: "createdAt" | "lastSeenAt",
  maxAgeMs: number
): Promise<number> {
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - maxAgeMs)
  let totalDeleted = 0

  while (true) {
    const snapshot = await db
      .collectionGroup(collectionId)
      .where(field, "<", cutoff)
      .limit(CLEANUP_BATCH_SIZE)
      .get()

    if (snapshot.empty) {
      break
    }

    const batch = db.batch()
    snapshot.docs.forEach((docSnap) => {
      batch.delete(docSnap.ref)
    })

    await batch.commit()
    totalDeleted += snapshot.size

    if (snapshot.size < CLEANUP_BATCH_SIZE) {
      break
    }
  }

  return totalDeleted
}

export const joinCollabRoom = onCall(async (request) => {
  assertAuthenticated(request)

  const contentId = assertString(request.data?.contentId, "contentId")
  const teamId = assertString(request.data?.teamId, "teamId")
  const workspaceId = assertString(request.data?.workspaceId, "workspaceId")
  const scope = assertWorkspaceNodeScope(request.data?.scope)

  await ensureContentExists(contentId, teamId, workspaceId, scope)

  const membershipRole = await resolveRole(
    request.auth.uid,
    teamId,
    workspaceId
  )
  assertCanViewWorkspace(request.auth.uid, membershipRole)

  const role = resolveCollabRole(request.auth.uid, membershipRole)
  const joinToken = mintJoinToken()
  const expiresAt = Date.now() + JOIN_TOKEN_TTL_MS
  const displayName =
    request.auth.token.name ?? request.auth.token.email ?? request.auth.uid

  // Optimized: Only create room if it doesn't exist - avoids unnecessary writes
  const roomRef = db.doc(`signaling/${contentId}`)
  const roomSnap = await roomRef.get()

  if (!roomSnap.exists) {
    await roomRef.set({
      contentId,
      teamId,
      workspaceId,
      scope,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  return {
    role,
    teamId,
    workspaceId,
    scope,
    displayName,
    userId: request.auth.uid,
    joinToken,
    expiresAt,
  }
})

export const createPeer = onCall(async (request) => {
  assertAuthenticated(request)

  const contentId = assertString(request.data?.contentId, "contentId")
  const peerId = assertString(request.data?.peerId, "peerId")
  const joinToken = assertString(request.data?.joinToken, "joinToken")

  const room = await getRoomContext(contentId)
  const membershipRole = await resolveRole(
    request.auth.uid,
    room.teamId,
    room.workspaceId
  )
  assertCanViewWorkspace(request.auth.uid, membershipRole)

  const role = resolveCollabRole(request.auth.uid, membershipRole)
  const displayName = sanitizeDisplayName(
    request.data?.displayName,
    request.auth.token.name ?? request.auth.token.email ?? request.auth.uid
  )
  const color = sanitizeColor(request.data?.color)

  await room.roomRef
    .collection("peers")
    .doc(peerId)
    .set(
      {
        peerId,
        userId: request.auth.uid,
        displayName,
        color,
        role,
        joinToken,
        tokenExpiresAt: Date.now() + JOIN_TOKEN_TTL_MS,
        joinedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

  return { ok: true }
})

export const heartbeatPeer = onCall(async (request) => {
  assertAuthenticated(request)

  const contentId = assertString(request.data?.contentId, "contentId")
  const peerId = assertString(request.data?.peerId, "peerId")
  const joinToken = assertString(request.data?.joinToken, "joinToken")

  // Optimized: Only fetch peer session, skip room context and role check
  // Role was already validated at peer creation time, and peer ownership check
  // ensures this is the same authenticated user
  const peerSession = await getPeerSession(contentId, peerId)

  assertPeerOwnership(peerSession.data, request.auth.uid, joinToken, {
    requireUnexpiredToken: true,
  })

  await peerSession.peerRef.update({
    lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
    tokenExpiresAt: Date.now() + JOIN_TOKEN_TTL_MS,
  })

  return { ok: true }
})

export const sendSignal = onCall(async (request) => {
  assertAuthenticated(request)

  const contentId = assertString(request.data?.contentId, "contentId")
  const fromPeerId = assertString(request.data?.fromPeerId, "fromPeerId")
  const toPeerId = assertString(request.data?.toPeerId, "toPeerId")
  const joinToken = assertString(request.data?.joinToken, "joinToken")
  const type = assertSignalType(request.data?.type)

  const [room, fromPeer, toPeerSnap] = await Promise.all([
    getRoomContext(contentId),
    getPeerSession(contentId, fromPeerId),
    db.doc(`signaling/${contentId}/peers/${toPeerId}`).get(),
  ])
  const membershipRole = await resolveRole(
    request.auth.uid,
    room.teamId,
    room.workspaceId
  )

  assertCanViewWorkspace(request.auth.uid, membershipRole)

  assertPeerOwnership(fromPeer.data, request.auth.uid, joinToken, {
    requireUnexpiredToken: true,
  })

  if (!toPeerSnap.exists) {
    throw new HttpsError("not-found", "Target peer does not exist.")
  }

  await room.roomRef.collection("signals").add({
    fromPeerId,
    toPeerId,
    type,
    payload: request.data?.payload ?? null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  return { ok: true }
})

export const deletePeer = onCall(async (request) => {
  assertAuthenticated(request)

  const contentId = assertString(request.data?.contentId, "contentId")
  const peerId = assertString(request.data?.peerId, "peerId")
  const joinToken = assertString(request.data?.joinToken, "joinToken")

  // Optimized: Only fetch peer session, skip room context and role check
  // Users can only delete their own peer sessions (verified by ownership check)
  const peerSession = await getPeerSession(contentId, peerId)

  assertPeerOwnership(peerSession.data, request.auth.uid, joinToken, {
    requireUnexpiredToken: false,
  })

  await peerSession.peerRef.delete()
  return { ok: true }
})

export const deleteSignal = onCall(async (request) => {
  assertAuthenticated(request)

  const contentId = assertString(request.data?.contentId, "contentId")
  const signalId = assertString(request.data?.signalId, "signalId")

  const room = await getRoomContext(contentId)
  const membershipRole = await resolveRole(
    request.auth.uid,
    room.teamId,
    room.workspaceId
  )
  assertCanViewWorkspace(request.auth.uid, membershipRole)

  await room.roomRef.collection("signals").doc(signalId).delete()
  return { ok: true }
})

export const deleteSignals = onCall(async (request) => {
  assertAuthenticated(request)

  const contentId = assertString(request.data?.contentId, "contentId")
  const signalIds = assertStringArray(request.data?.signalIds, "signalIds", {
    maxLength: 100,
  })

  if (!signalIds.length) {
    return { ok: true }
  }

  const room = await getRoomContext(contentId)
  const membershipRole = await resolveRole(
    request.auth.uid,
    room.teamId,
    room.workspaceId
  )
  assertCanViewWorkspace(request.auth.uid, membershipRole)

  const batch = db.batch()
  signalIds.forEach((signalId) => {
    batch.delete(room.roomRef.collection("signals").doc(signalId))
  })
  await batch.commit()

  return { ok: true }
})

export const cleanupCollabSignaling = onSchedule(
  "every 1 hours", // Reduced from 10 minutes - clients clean up signals, this is fallback
  async () => {
    const [signalsDeleted, peersDeleted] = await Promise.all([
      cleanupCollectionGroup("signals", "createdAt", STALE_SIGNAL_MAX_AGE_MS),
      cleanupCollectionGroup("peers", "lastSeenAt", STALE_PEER_MAX_AGE_MS),
    ])

    console.info("[collab:cleanup] Deleted stale docs", {
      signalsDeleted,
      peersDeleted,
    })
  }
)
