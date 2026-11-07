/**
 * Pure branch logic over the chat record's `snapshotChildren` index and
 * snapshot threads. No Firestore here, so it's testable on its own.
 */

import type { MessageData } from "genkit"

/** User-message metadata: who sent it, and the snapshot its turn started from. */
export const AUTHOR_METADATA_KEY = "lectornautAuthorUid"
export const PARENT_SNAPSHOT_METADATA_KEY = "lectornautParentSnapshotId"

/** parentId → child snapshot ids, oldest first. */
export type SnapshotChildren = Record<string, string[]>

/** Whether `id` is filed under some parent — i.e. a real branch of this chat. */
export const isBranch = (children: SnapshotChildren, id: string): boolean =>
  Object.values(children).some((ids) => ids.includes(id))

/**
 * The newest snapshot down `from`'s branch: follow the latest child until
 * there is none. Switching to a version lands where that version left off.
 */
export function branchLeaf(children: SnapshotChildren, from: string): string {
  const seen = new Set([from])
  let leaf = from
  for (;;) {
    const next = children[leaf]?.at(-1)
    if (!next || seen.has(next)) return leaf
    seen.add(next)
    leaf = next
  }
}

/**
 * Split a copied thread for a new chat: `root` is everything before its last
 * user message, `head` is the whole thread. The copied user messages' parent
 * ids point into the SOURCE chat, so they're dropped — except the last one,
 * re-pointed at `rootId`, so the branch can edit or regenerate it at once.
 * Earlier bubbles are edited in the source chat.
 */
export function forkThread(
  thread: readonly MessageData[],
  rootId: string
): { root: MessageData[]; head: MessageData[] } {
  const last = thread.map((m) => m.role).lastIndexOf("user")
  const head = thread.map((m, i) => {
    if (m.role !== "user") return m
    const { [PARENT_SNAPSHOT_METADATA_KEY]: _source, ...metadata } =
      m.metadata ?? {}
    if (i === last) metadata[PARENT_SNAPSHOT_METADATA_KEY] = rootId
    return { ...m, metadata }
  })
  return { root: last < 0 ? head : head.slice(0, last), head }
}
