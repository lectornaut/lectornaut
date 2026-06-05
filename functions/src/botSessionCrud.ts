/**
 * Bot session metadata callables — load, find-by-pinned-node, visibility,
 * rename, archive, delete.
 *
 * These are plain `onCall` endpoints (no Genkit streaming), gated by
 * `requireVerifiedAuth` + role checks. Each operates on a single
 * session doc at
 *   teams/{teamId}/workspaces/{workspaceId}/botSessions/{sessionId}
 *
 * Extracted from `bot.ts` so that file can focus on the chat-flow
 * orchestration (streaming, agent dispatch, tool calling). The CRUD
 * callables share auth helpers + `readSessionDoc` + `pinnedNodeKey`
 * with the chat flow but don't touch its streaming machinery — clean
 * extraction.
 *
 * Permission model:
 *   - load: owner OR (visibility === "shared" AND team member)
 *   - findByPinnedNode: any team member (returns at most their own pin)
 *   - updateVisibility: owner OR team admin
 *   - rename / archive / delete: owner OR team admin (`assertCanMutate`)
 */

import {
  HttpsError,
  onCall,
  type CallableRequest,
} from "firebase-functions/v2/https"
import {
  extractMessagesFromSessionData,
  getMembershipRole,
  pinnedNodeKey,
  readSessionDoc,
  requireVerifiedAuth,
  type ChatMessage,
  type SessionVisibility,
} from "./bot.js"
import { admin, db } from "./firebase.js"
import { isAdminRole } from "./permissions.js"
import { CALLABLE_OPTS } from "./runtimeConfig.js"

// `AuthData` isn't re-exported from `firebase-functions/v2/https`, so derive
// it from `CallableRequest["auth"]`. Currently unused inside this file —
// the helpers we import already narrow auth for us — but kept here for
// parity with the other callables files in case a future CRUD endpoint
// needs to introspect auth fields directly.
type _AuthData = NonNullable<CallableRequest["auth"]>
void (null as unknown as _AuthData)

// ===========================================================================
// Read: loadBotSession
// ===========================================================================

interface LoadBotSessionRequest {
  teamId: string
  workspaceId: string
  sessionId: string
}

interface LoadBotSessionResponse {
  sessionId: string
  /** Includes `segments` for agent messages with tool calls. */
  messages: ChatMessage[]
}

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
    const auth = requireVerifiedAuth(request.auth)

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

    await getMembershipRole(teamId, auth.uid)

    const existing = await readSessionDoc(teamId, workspaceId, sessionId)
    if (!existing) {
      throw new HttpsError("not-found", "Session not found.")
    }

    const isOwner = existing.ownerUid === auth.uid
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

// ===========================================================================
// findBotSessionByPinnedNode — resolve the caller's chat that's pinned to
// a specific workspace node, if any.
// ===========================================================================
//
// The NodeInspectorSidebar's Bot tab calls this on open so each node has a
// stable, resumable chat per user. We key on `pinnedNodeKey` (a single
// composite string of `${ownerUid}:${scope}:${nodeId}`) so the query is a
// single equality clause — no composite index needed. Returns null when no
// session exists yet; the next `sendBotMessage` will create one with the
// matching `pinnedNode`.

interface FindBotSessionByPinnedNodeRequest {
  teamId: string
  workspaceId: string
  scope: "code" | "write"
  nodeId: string
}

interface FindBotSessionByPinnedNodeResponse {
  sessionId: string | null
}

export const findBotSessionByPinnedNode =
  onCall<FindBotSessionByPinnedNodeRequest>(
    {
      ...CALLABLE_OPTS,
      enforceAppCheck: true,
    },
    async (request): Promise<FindBotSessionByPinnedNodeResponse> => {
      const auth = requireVerifiedAuth(request.auth)
      const { teamId, workspaceId, scope, nodeId } = request.data ?? {}

      if (typeof teamId !== "string" || !teamId) {
        throw new HttpsError("invalid-argument", "teamId is required.")
      }
      if (typeof workspaceId !== "string" || !workspaceId) {
        throw new HttpsError("invalid-argument", "workspaceId is required.")
      }
      if (scope !== "code" && scope !== "write") {
        throw new HttpsError(
          "invalid-argument",
          'scope must be "code" or "write".'
        )
      }
      if (typeof nodeId !== "string" || !nodeId) {
        throw new HttpsError("invalid-argument", "nodeId is required.")
      }

      // Membership gate — non-members shouldn't even know whether the
      // session exists. We don't widen access for shared sessions here:
      // the Bot tab is a per-user "ask about this node" view; collab
      // chats live on the bot page's history sidebar.
      await getMembershipRole(teamId, auth.uid)

      // Multiple pinned chats can exist for the same (user, node) pair
      // — each "new chat" click in the inspector creates another. We
      // resume the most recently active one by default; the history
      // list in the inspector shows the rest.
      const snap = await db
        .collection(`teams/${teamId}/workspaces/${workspaceId}/botSessions`)
        .where("pinnedNodeKey", "==", pinnedNodeKey(auth.uid, scope, nodeId))
        .orderBy("updatedAt", "desc")
        .limit(1)
        .get()

      if (snap.empty) return { sessionId: null }
      return { sessionId: snap.docs[0].id }
    }
  )

// ===========================================================================
// Update visibility
// ===========================================================================

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
      const auth = requireVerifiedAuth(request.auth)

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

      const role = await getMembershipRole(teamId, auth.uid)
      const existing = await readSessionDoc(teamId, workspaceId, sessionId)
      if (!existing) {
        throw new HttpsError("not-found", "Session not found.")
      }

      const isOwner = existing.ownerUid === auth.uid
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
    const auth = requireVerifiedAuth(request.auth)
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

    await assertCanMutate(teamId, workspaceId, sessionId, auth.uid)

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
    const auth = requireVerifiedAuth(request.auth)
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

    await assertCanMutate(teamId, workspaceId, sessionId, auth.uid)

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
    const auth = requireVerifiedAuth(request.auth)
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

    await assertCanMutate(teamId, workspaceId, sessionId, auth.uid)

    // Single document; no subcollections to traverse.
    await db
      .doc(`teams/${teamId}/workspaces/${workspaceId}/botSessions/${sessionId}`)
      .delete()

    return { sessionId, deleted: true }
  }
)
