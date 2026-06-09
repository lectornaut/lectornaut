/**
 * Bot session metadata callables — load, find-by-pinned-node, visibility,
 * rename, archive, delete.
 *
 * These are plain callables (no Genkit streaming). Each declares its outer ring
 * through {@link defineCallable} — `auth: "verified"` + `appCheck: true` + a Zod
 * `input` schema — so the handler writes only business logic. Each operates on a
 * single session doc at
 *   teams/{teamId}/workspaces/{workspaceId}/botSessions/{sessionId}
 *
 * Extracted from `bot.ts` so that file can focus on the chat-flow orchestration
 * (streaming, agent dispatch, tool calling). The CRUD callables share
 * `readSessionDoc` + `pinnedNodeKey` with the chat flow but don't touch its
 * streaming machinery — clean extraction.
 *
 * Permission model:
 *   - load: owner OR (visibility === "shared" AND team member)
 *   - findByPinnedNode: any team member (returns at most their own pin)
 *   - updateVisibility: owner OR team admin
 *   - rename / archive / delete: owner OR team admin (`assertCanMutate`)
 */

import { FieldValue } from "firebase-admin/firestore"
import { HttpsError } from "firebase-functions/v2/https"
import { z } from "zod"
import {
  extractMessagesFromSessionData,
  getMembershipRole,
  pinnedNodeKey,
  readSessionDoc,
  type ChatMessage,
  type SessionVisibility,
} from "./bot.js"
import { defineCallable } from "./defineCallable.js"
import { db } from "./firebase.js"
import { isAdminRole } from "./permissions.js"

/** The three-part address every session callable needs to resolve one doc. */
const sessionTargetSchema = z.object({
  teamId: z.string().min(1),
  workspaceId: z.string().min(1),
  sessionId: z.string().min(1),
})

// ===========================================================================
// Read: loadBotSession
// ===========================================================================

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
export const loadBotSession = defineCallable({
  name: "loadBotSession",
  auth: "verified",
  appCheck: true,
  input: sessionTargetSchema,
  handler: async ({ auth, input }): Promise<LoadBotSessionResponse> => {
    const { teamId, workspaceId, sessionId } = input

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
  },
})

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

interface FindBotSessionByPinnedNodeResponse {
  sessionId: string | null
}

export const findBotSessionByPinnedNode = defineCallable({
  name: "findBotSessionByPinnedNode",
  auth: "verified",
  appCheck: true,
  input: z.object({
    teamId: z.string().min(1),
    workspaceId: z.string().min(1),
    scope: z.enum(["code", "write"]),
    nodeId: z.string().min(1),
  }),
  handler: async ({
    auth,
    input,
  }): Promise<FindBotSessionByPinnedNodeResponse> => {
    const { teamId, workspaceId, scope, nodeId } = input

    // Membership gate — non-members shouldn't even know whether the session
    // exists. We don't widen access for shared sessions here: the Bot tab is a
    // per-user "ask about this node" view; collab chats live on the bot page's
    // history sidebar.
    await getMembershipRole(teamId, auth.uid)

    // Multiple pinned chats can exist for the same (user, node) pair — each
    // "new chat" click in the inspector creates another. We resume the most
    // recently active one by default; the history list shows the rest.
    const snap = await db
      .collection(`teams/${teamId}/workspaces/${workspaceId}/botSessions`)
      .where("pinnedNodeKey", "==", pinnedNodeKey(auth.uid, scope, nodeId))
      .orderBy("updatedAt", "desc")
      .limit(1)
      .get()

    if (snap.empty) return { sessionId: null }
    return { sessionId: snap.docs[0].id }
  },
})

// ===========================================================================
// Update visibility
// ===========================================================================

interface UpdateBotSessionVisibilityResponse {
  sessionId: string
  visibility: SessionVisibility
}

/**
 * Change a session's visibility. Only the session owner or a team admin can
 * change it. The "public" mode is rejected by the schema — its read path is not
 * yet implemented and we don't want orphaned-public sessions accruing.
 */
export const updateBotSessionVisibility = defineCallable({
  name: "updateBotSessionVisibility",
  auth: "verified",
  appCheck: true,
  input: sessionTargetSchema.extend({
    visibility: z.enum(["private", "shared"]),
  }),
  handler: async ({
    auth,
    input,
  }): Promise<UpdateBotSessionVisibilityResponse> => {
    const { teamId, workspaceId, sessionId, visibility } = input

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
      .doc(`teams/${teamId}/workspaces/${workspaceId}/botSessions/${sessionId}`)
      .set(
        {
          visibility,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )

    return { sessionId, visibility }
  },
})

// ===========================================================================
// CRUD: rename, archive, delete
// ===========================================================================

const TITLE_LIMIT = 120

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

interface RenameBotSessionResponse {
  sessionId: string
  title: string
}

export const renameBotSession = defineCallable({
  name: "renameBotSession",
  auth: "verified",
  appCheck: true,
  // `title` is validated as a string here; the trimmed-non-empty check stays in
  // the handler because the stored value is the trimmed-and-truncated form.
  input: sessionTargetSchema.extend({ title: z.string() }),
  handler: async ({ auth, input }): Promise<RenameBotSessionResponse> => {
    const { teamId, workspaceId, sessionId } = input
    const trimmed = input.title.trim().slice(0, TITLE_LIMIT)
    if (!trimmed) {
      throw new HttpsError("invalid-argument", "title is required.")
    }

    await assertCanMutate(teamId, workspaceId, sessionId, auth.uid)

    await db
      .doc(`teams/${teamId}/workspaces/${workspaceId}/botSessions/${sessionId}`)
      .set(
        {
          title: trimmed,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )

    return { sessionId, title: trimmed }
  },
})

interface ArchiveBotSessionResponse {
  sessionId: string
  archived: boolean
}

export const archiveBotSession = defineCallable({
  name: "archiveBotSession",
  auth: "verified",
  appCheck: true,
  input: sessionTargetSchema.extend({ archived: z.boolean() }),
  handler: async ({ auth, input }): Promise<ArchiveBotSessionResponse> => {
    const { teamId, workspaceId, sessionId, archived } = input

    await assertCanMutate(teamId, workspaceId, sessionId, auth.uid)

    await db
      .doc(`teams/${teamId}/workspaces/${workspaceId}/botSessions/${sessionId}`)
      .set(
        {
          archivedAt: archived ? FieldValue.serverTimestamp() : null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )

    return { sessionId, archived }
  },
})

interface DeleteBotSessionResponse {
  sessionId: string
  deleted: true
}

export const deleteBotSession = defineCallable({
  name: "deleteBotSession",
  auth: "verified",
  appCheck: true,
  input: sessionTargetSchema,
  handler: async ({ auth, input }): Promise<DeleteBotSessionResponse> => {
    const { teamId, workspaceId, sessionId } = input

    await assertCanMutate(teamId, workspaceId, sessionId, auth.uid)

    // Single document; no subcollections to traverse.
    await db
      .doc(`teams/${teamId}/workspaces/${workspaceId}/botSessions/${sessionId}`)
      .delete()

    return { sessionId, deleted: true }
  },
})
