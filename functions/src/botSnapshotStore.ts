/**
 * Storage layout for the bot's conversation history: Genkit's official
 * `FirestoreSessionStore` (`@genkit-ai/firebase/beta`), one immutable snapshot
 * per turn under a per-CHAT prefix. The agent wiring (store instance, chat
 * record projection) lives in `bot.ts`; this module is only the layout, so
 * deletion paths (`botSessionCrud.ts`, `audit.ts`) can use it without
 * importing the chat flow.
 *
 * Collections are top-level and server-only (the rules' default deny):
 *   botSnapshots/<prefix>/snapshots/<snapshotId>
 *   botSnapshots-pointers/<prefix>/pointers/<sessionId>
 *   botSnapshots-shards/<prefix>/shards/<checkpointId>_<i>
 */

import { db } from "./firebase.js"

export const BOT_SNAPSHOT_COLLECTION = "botSnapshots"

/** The chat a store call belongs to. */
export interface BotSessionKey {
  readonly teamId: string
  readonly workspaceId: string
  readonly sessionId: string
}

/**
 * Store-call context. `chat(…, { context })` binds it to every turn and store
 * call of that chat (Genkit `LocalAgentOptions`); direct reads pass it.
 */
export const botSessionContext = (key: BotSessionKey) => ({
  botSession: {
    teamId: key.teamId,
    workspaceId: key.workspaceId,
    sessionId: key.sessionId,
  },
})

/**
 * Per-chat prefix (Genkit's per-tenant `snapshotPathPrefix`): a snapshot id
 * can't be read across chats, and a chat's history is one subtree per
 * collection.
 */
export const snapshotPrefixFor = (key: BotSessionKey): string =>
  `${key.teamId}_${key.workspaceId}_${key.sessionId}`

/**
 * Delete a chat's whole conversation history: every snapshot, the session
 * pointer, and the checkpoint shards. The chat record is the caller's.
 */
export async function deleteBotSessionHistory(
  key: BotSessionKey
): Promise<void> {
  const prefix = snapshotPrefixFor(key)
  await Promise.all(
    ["", "-pointers", "-shards"].map((suffix) =>
      db.recursiveDelete(
        db.doc(`${BOT_SNAPSHOT_COLLECTION}${suffix}/${prefix}`)
      )
    )
  )
}

/**
 * Delete the history of every chat in a workspace. Call BEFORE the workspace
 * subtree (and its chat records) is deleted — the records are the index.
 */
export async function deleteWorkspaceBotHistory(
  teamId: string,
  workspaceId: string
): Promise<void> {
  // ponytail: a new chat's root snapshot whose first turn never committed has
  // no record, so it isn't listed here; it's an empty thread, harmless.
  const records = await db
    .collection(`teams/${teamId}/workspaces/${workspaceId}/botSessions`)
    .listDocuments()
  for (const ref of records) {
    await deleteBotSessionHistory({ teamId, workspaceId, sessionId: ref.id })
  }
}
