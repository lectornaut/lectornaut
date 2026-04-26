/**
 * Bot Chat — Genkit chat sessions persisted to team/workspace context.
 *
 * Each chat session lives at:
 *   teams/{teamId}/workspaces/{workspaceId}/botSessions/{sessionId}
 *
 * The session document keeps the full Genkit `SessionData<S>` blob in
 * `data` (round-tripped opaquely by the SessionStore) plus a handful of
 * index fields (`ownerUid`, `visibility`, `title`, `preview`,
 * `messageCount`, `updatedAt`) so the history sidebar can render
 * without parsing the blob client-side.
 *
 * Visibility model:
 *   - private (default): only the owner can read/write.
 *   - shared:  any team member can read; only owner + team admins write.
 *   - public:  reserved for future — read path not implemented.
 *
 * The `SessionStore.save()` deliberately does NOT touch `visibility` —
 * Genkit calls save on every chat turn, and we don't want a turn write
 * to race with the user's visibility toggle. Visibility is owned by the
 * `updateBotSessionVisibility` callable.
 */

import { HttpsError, onCall } from "firebase-functions/v2/https"
import type { SessionData, SessionStore } from "genkit/beta"
import { admin, db } from "./firebase.js"
import { ai } from "./genkitClient.js"
import { CALLABLE_OPTS } from "./runtimeConfig.js"
import { geminiApiKey } from "./secrets.js"
import type { IMembershipRole } from "./types.js"

type SessionVisibility = "private" | "shared" | "public"
const ADMIN_ROLES: ReadonlyArray<IMembershipRole> = ["owner", "admin"]

const MAIN_THREAD = "main"
const TITLE_MAX_LENGTH = 80
const PREVIEW_MAX_LENGTH = 200

type ChatRole = "user" | "agent"

interface ChatMessage {
  role: ChatRole
  content: string
}

interface PartLike {
  text?: string
}

interface MessageLike {
  role?: string
  content?: PartLike[] | string
}

/**
 * Pull plain-text messages out of a Genkit `SessionData` blob's main thread.
 * Defensive against future schema drift: extra parts (media, tool calls)
 * collapse to their text portion if any, otherwise are skipped. System
 * messages are filtered out — they aren't user-facing turns.
 */
function extractMessagesFromSessionData(
  data: SessionData | undefined
): ChatMessage[] {
  if (!data?.threads) return []
  const thread = data.threads[MAIN_THREAD]
  if (!Array.isArray(thread)) return []

  const messages: ChatMessage[] = []
  for (const raw of thread as MessageLike[]) {
    const role = raw?.role
    if (role !== "user" && role !== "model") continue

    const content = raw.content
    let text = ""
    if (typeof content === "string") {
      text = content
    } else if (Array.isArray(content)) {
      text = content
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("")
    }
    if (!text.trim()) continue

    messages.push({ role: role === "user" ? "user" : "agent", content: text })
  }
  return messages
}

function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user")
  const source = firstUser?.content?.trim() ?? ""
  if (!source) return "New chat"
  const collapsed = source.replace(/\s+/g, " ")
  return collapsed.length > TITLE_MAX_LENGTH
    ? `${collapsed.slice(0, TITLE_MAX_LENGTH).trimEnd()}…`
    : collapsed
}

function derivePreview(messages: ChatMessage[]): string {
  const last = messages[messages.length - 1]
  const source = last?.content?.trim() ?? ""
  if (!source) return ""
  const collapsed = source.replace(/\s+/g, " ")
  return collapsed.length > PREVIEW_MAX_LENGTH
    ? `${collapsed.slice(0, PREVIEW_MAX_LENGTH).trimEnd()}…`
    : collapsed
}

/**
 * Firestore-backed `SessionStore` scoped to one (teamId, workspaceId) pair.
 * Genkit calls `get(sessionId)` and `save(sessionId, data)` — we round-trip
 * the entire session blob as JSON, and on each save we additionally derive
 * sidebar metadata (title, preview, messageCount).
 */
class FirestoreBotSessionStore implements SessionStore {
  constructor(
    private readonly teamId: string,
    private readonly workspaceId: string,
    private readonly ownerUid: string
  ) {}

  private docRef(sessionId: string) {
    return db.doc(
      `teams/${this.teamId}/workspaces/${this.workspaceId}/botSessions/${sessionId}`
    )
  }

  async get(sessionId: string): Promise<SessionData | undefined> {
    const snap = await this.docRef(sessionId).get()
    if (!snap.exists) return undefined
    const raw = snap.data()?.data
    return raw ? (raw as SessionData) : undefined
  }

  async save(sessionId: string, data: SessionData): Promise<void> {
    const ref = this.docRef(sessionId)
    const snap = await ref.get()
    const isNew = !snap.exists
    const messages = extractMessagesFromSessionData(data)

    // Genkit's SessionData has `state?: S` and other optional fields that
    // arrive as `undefined` when not used. Firestore's default validator
    // rejects any undefined value in a write — so we round-trip through
    // JSON to drop them. The blob is JSON-serializable by contract (the
    // SessionStore interface is built for this round-trip).
    const sanitizedData = JSON.parse(JSON.stringify(data))

    const update: Record<string, unknown> = {
      // The codebase's `zodConverter` reads `id` from the document body
      // (not from `snap.id`), so it must live in the body to satisfy
      // `botSessionSchema` on read. Idempotent — same string every save,
      // so writing it always keeps legacy docs (saved before this field
      // existed) self-healing on the next chat turn.
      id: sessionId,
      data: sanitizedData,
      teamId: this.teamId,
      workspaceId: this.workspaceId,
      ownerUid: this.ownerUid,
      preview: derivePreview(messages),
      messageCount: messages.length,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }

    // Title is set once on creation and frozen afterward — the rename
    // callable is the sole writer past that point. createdAt and the
    // null archivedAt sentinel are also one-shot writes.
    if (isNew) {
      update.title = deriveTitle(messages)
      update.createdAt = admin.firestore.FieldValue.serverTimestamp()
      update.archivedAt = null
    }

    await ref.set(update, { merge: true })
  }
}

const SYSTEM_PROMPT =
  "You are a helpful assistant for the user's team workspace. " +
  "Answer concisely and stay focused on the user's question."

interface SendBotMessageRequest {
  teamId: string
  workspaceId: string
  sessionId?: string | null
  message: string
}

interface SendBotMessageResponse {
  sessionId: string
  reply: string
}

interface LoadBotSessionRequest {
  teamId: string
  workspaceId: string
  sessionId: string
}

interface LoadBotSessionResponse {
  sessionId: string
  messages: ChatMessage[]
}

/**
 * Read the caller's membership doc and return their role. Throws if the
 * caller has no membership in the team.
 */
async function getMembershipRole(
  teamId: string,
  uid: string
): Promise<IMembershipRole> {
  const snap = await db.doc(`teams/${teamId}/memberships/${uid}`).get()
  if (!snap.exists) {
    throw new HttpsError(
      "permission-denied",
      "You are not a member of this team."
    )
  }
  return snap.data()?.role as IMembershipRole
}

function isAdminRole(role: IMembershipRole | null | undefined): boolean {
  return !!role && ADMIN_ROLES.includes(role)
}

interface BotSessionDocSummary {
  ownerUid: string
  visibility: SessionVisibility
  archived: boolean
  data?: SessionData
}

/** Load a session doc and normalize visibility (absent ⇒ "private"). */
async function readSessionDoc(
  teamId: string,
  workspaceId: string,
  sessionId: string
): Promise<BotSessionDocSummary | null> {
  const snap = await db
    .doc(`teams/${teamId}/workspaces/${workspaceId}/botSessions/${sessionId}`)
    .get()
  if (!snap.exists) return null
  const data = snap.data() ?? {}
  const rawVisibility = data.visibility
  const visibility: SessionVisibility =
    rawVisibility === "shared" || rawVisibility === "public"
      ? rawVisibility
      : "private"
  return {
    ownerUid: data.ownerUid as string,
    visibility,
    archived: !!data.archivedAt,
    data: data.data as SessionData | undefined,
  }
}

export const sendBotMessage = onCall<SendBotMessageRequest>(
  {
    ...CALLABLE_OPTS,
    secrets: [geminiApiKey],
    enforceAppCheck: true,
  },
  async (request): Promise<SendBotMessageResponse> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign-in required.")
    }

    const { teamId, workspaceId, sessionId, message } = request.data ?? {}

    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }
    if (typeof workspaceId !== "string" || !workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.")
    }
    if (typeof message !== "string" || !message.trim()) {
      throw new HttpsError("invalid-argument", "message is required.")
    }

    const role = await getMembershipRole(teamId, request.auth.uid)

    // For existing sessions, enforce edit permission server-side. The
    // owner always has edit; for shared sessions, team admins also have
    // edit. Archived sessions reject sends regardless of role —
    // archiving is a soft "read-only" flag the user (or an admin) sets.
    // New sessions (no sessionId yet) default to private and the caller
    // is the owner-to-be.
    if (sessionId) {
      const existing = await readSessionDoc(teamId, workspaceId, sessionId)
      if (!existing) {
        throw new HttpsError("not-found", "Session not found.")
      }
      if (existing.archived) {
        throw new HttpsError(
          "failed-precondition",
          "This chat is archived. Restore it before sending new messages."
        )
      }
      const isOwner = existing.ownerUid === request.auth.uid
      const canEdit =
        isOwner || (existing.visibility === "shared" && isAdminRole(role))
      if (!canEdit) {
        throw new HttpsError(
          "permission-denied",
          "You don't have permission to send messages in this chat."
        )
      }
    }

    const store = new FirestoreBotSessionStore(
      teamId,
      workspaceId,
      request.auth.uid
    )

    const session = sessionId
      ? await ai.loadSession(sessionId, { store })
      : ai.createSession({ store })

    const chat = sessionId
      ? session.chat()
      : session.chat({ system: SYSTEM_PROMPT })

    const { text } = await chat.send(message)

    return {
      sessionId: session.id,
      reply: text,
    }
  }
)

/**
 * Resume an existing session: fetches the persisted `SessionData` blob and
 * returns its main-thread messages so the client can render the prior
 * conversation. Allowed when the caller is the owner OR the session's
 * visibility is "shared" and the caller is a team member.
 */
export const loadBotSession = onCall<LoadBotSessionRequest>(
  {
    ...CALLABLE_OPTS,
    enforceAppCheck: true,
  },
  async (request): Promise<LoadBotSessionResponse> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign-in required.")
    }

    const { teamId, workspaceId, sessionId } = request.data ?? {}

    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }
    if (typeof workspaceId !== "string" || !workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.")
    }
    if (typeof sessionId !== "string" || !sessionId) {
      throw new HttpsError("invalid-argument", "sessionId is required.")
    }

    await getMembershipRole(teamId, request.auth.uid)

    const existing = await readSessionDoc(teamId, workspaceId, sessionId)
    if (!existing) {
      throw new HttpsError("not-found", "Session not found.")
    }

    const isOwner = existing.ownerUid === request.auth.uid
    const isShared = existing.visibility === "shared"
    if (!isOwner && !isShared) {
      throw new HttpsError(
        "permission-denied",
        "You don't have access to this chat."
      )
    }

    const messages = extractMessagesFromSessionData(existing.data)
    return { sessionId, messages }
  }
)

interface UpdateBotSessionVisibilityRequest {
  teamId: string
  workspaceId: string
  sessionId: string
  visibility: SessionVisibility
}

interface UpdateBotSessionVisibilityResponse {
  sessionId: string
  visibility: SessionVisibility
}

/**
 * Change a session's visibility. Only the session owner or a team admin
 * can change it. The "public" mode is rejected here — its read path is
 * not yet implemented and we don't want orphaned-public sessions accruing.
 */
export const updateBotSessionVisibility =
  onCall<UpdateBotSessionVisibilityRequest>(
    {
      ...CALLABLE_OPTS,
      enforceAppCheck: true,
    },
    async (request): Promise<UpdateBotSessionVisibilityResponse> => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Sign-in required.")
      }

      const { teamId, workspaceId, sessionId, visibility } = request.data ?? {}

      if (typeof teamId !== "string" || !teamId) {
        throw new HttpsError("invalid-argument", "teamId is required.")
      }
      if (typeof workspaceId !== "string" || !workspaceId) {
        throw new HttpsError("invalid-argument", "workspaceId is required.")
      }
      if (typeof sessionId !== "string" || !sessionId) {
        throw new HttpsError("invalid-argument", "sessionId is required.")
      }
      if (visibility !== "private" && visibility !== "shared") {
        throw new HttpsError(
          "invalid-argument",
          'visibility must be "private" or "shared".'
        )
      }

      const role = await getMembershipRole(teamId, request.auth.uid)
      const existing = await readSessionDoc(teamId, workspaceId, sessionId)
      if (!existing) {
        throw new HttpsError("not-found", "Session not found.")
      }

      const isOwner = existing.ownerUid === request.auth.uid
      const canChange = isOwner || isAdminRole(role)
      if (!canChange) {
        throw new HttpsError(
          "permission-denied",
          "Only the owner or a team admin can change visibility."
        )
      }

      await db
        .doc(
          `teams/${teamId}/workspaces/${workspaceId}/botSessions/${sessionId}`
        )
        .set(
          {
            visibility,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        )

      return { sessionId, visibility }
    }
  )

// ===========================================================================
// CRUD: rename, archive, delete
// ===========================================================================

const TITLE_LIMIT = 120

interface SessionMutationBase {
  teamId: string
  workspaceId: string
  sessionId: string
}

/** Owner OR team admin can mutate (rename / archive / delete). */
async function assertCanMutate(
  teamId: string,
  workspaceId: string,
  sessionId: string,
  uid: string
): Promise<void> {
  const role = await getMembershipRole(teamId, uid)
  const existing = await readSessionDoc(teamId, workspaceId, sessionId)
  if (!existing) {
    throw new HttpsError("not-found", "Session not found.")
  }
  const isOwner = existing.ownerUid === uid
  if (!isOwner && !isAdminRole(role)) {
    throw new HttpsError(
      "permission-denied",
      "Only the owner or a team admin can modify this chat."
    )
  }
}

interface RenameBotSessionRequest extends SessionMutationBase {
  title: string
}
interface RenameBotSessionResponse {
  sessionId: string
  title: string
}

export const renameBotSession = onCall<RenameBotSessionRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request): Promise<RenameBotSessionResponse> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign-in required.")
    }
    const { teamId, workspaceId, sessionId, title } = request.data ?? {}

    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }
    if (typeof workspaceId !== "string" || !workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.")
    }
    if (typeof sessionId !== "string" || !sessionId) {
      throw new HttpsError("invalid-argument", "sessionId is required.")
    }
    if (typeof title !== "string" || !title.trim()) {
      throw new HttpsError("invalid-argument", "title is required.")
    }
    const trimmed = title.trim().slice(0, TITLE_LIMIT)

    await assertCanMutate(teamId, workspaceId, sessionId, request.auth.uid)

    await db
      .doc(`teams/${teamId}/workspaces/${workspaceId}/botSessions/${sessionId}`)
      .set(
        {
          title: trimmed,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      )

    return { sessionId, title: trimmed }
  }
)

interface ArchiveBotSessionRequest extends SessionMutationBase {
  archived: boolean
}
interface ArchiveBotSessionResponse {
  sessionId: string
  archived: boolean
}

export const archiveBotSession = onCall<ArchiveBotSessionRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request): Promise<ArchiveBotSessionResponse> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign-in required.")
    }
    const { teamId, workspaceId, sessionId, archived } = request.data ?? {}

    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }
    if (typeof workspaceId !== "string" || !workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.")
    }
    if (typeof sessionId !== "string" || !sessionId) {
      throw new HttpsError("invalid-argument", "sessionId is required.")
    }
    if (typeof archived !== "boolean") {
      throw new HttpsError("invalid-argument", "archived must be a boolean.")
    }

    await assertCanMutate(teamId, workspaceId, sessionId, request.auth.uid)

    await db
      .doc(`teams/${teamId}/workspaces/${workspaceId}/botSessions/${sessionId}`)
      .set(
        {
          archivedAt: archived
            ? admin.firestore.FieldValue.serverTimestamp()
            : null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      )

    return { sessionId, archived }
  }
)

type DeleteBotSessionRequest = SessionMutationBase
interface DeleteBotSessionResponse {
  sessionId: string
  deleted: true
}

export const deleteBotSession = onCall<DeleteBotSessionRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request): Promise<DeleteBotSessionResponse> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign-in required.")
    }
    const { teamId, workspaceId, sessionId } = request.data ?? {}

    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }
    if (typeof workspaceId !== "string" || !workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.")
    }
    if (typeof sessionId !== "string" || !sessionId) {
      throw new HttpsError("invalid-argument", "sessionId is required.")
    }

    await assertCanMutate(teamId, workspaceId, sessionId, request.auth.uid)

    // Single document; no subcollections to traverse.
    await db
      .doc(`teams/${teamId}/workspaces/${workspaceId}/botSessions/${sessionId}`)
      .delete()

    return { sessionId, deleted: true }
  }
)
