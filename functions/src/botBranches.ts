/**
 * Pure chat-turn logic: the `snapshotChildren` branch index, snapshot
 * threads, and the turn lock's state. No Firestore here, so it's testable.
 */

import type { MessageData } from "genkit"

/** User-message metadata: who sent it, and the snapshot its turn started from. */
export const AUTHOR_METADATA_KEY = "lectornautAuthorUid"
export const PARENT_SNAPSHOT_METADATA_KEY = "lectornautParentSnapshotId"
/** Any thread message: ISO time it was sent (user) or committed (model/tool). */
export const SENT_AT_METADATA_KEY = "lectornautSentAt"

/**
 * Stamp `at` on every message that has no sent-at yet. Already-stamped
 * messages keep theirs, so a thread re-saved turn after turn only stamps
 * what's new. Legacy messages saved before this existed stay unstamped.
 */
export function stampSentAt(
  messages: readonly MessageData[],
  at: string
): MessageData[] {
  return messages.map((m) =>
    m.metadata?.[SENT_AT_METADATA_KEY]
      ? m
      : { ...m, metadata: { ...m.metadata, [SENT_AT_METADATA_KEY]: at } }
  )
}

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

/**
 * Where a failed turn can be continued from — Genkit's "send `{}` to a
 * `failed`/`aborted` snapshot" resume, which picks up after the finished tool
 * calls instead of repeating them. Only for a head that is a persisted error
 * reply stacked on a committed failure: the parent is `failed`/`aborted` and
 * its thread ends with a tool result (user message + complete tool rounds).
 * Anything else (a rolled-back failure, a normal reply) has nothing to resume.
 */
export function failedTurnResumePoint(
  headIsErrorReply: boolean,
  parent:
    | {
        snapshotId: string
        status?: string
        state?: { messages?: readonly MessageData[] }
      }
    | undefined
): string | null {
  if (!headIsErrorReply || !parent) return null
  if (parent.status !== "failed" && parent.status !== "aborted") return null
  return parent.state?.messages?.at(-1)?.role === "tool"
    ? parent.snapshotId
    : null
}

/**
 * A chat's turn lock, as a new turn sees it: `free` to take (none, lease
 * expired, or a stop nobody answered within `stopWaitMs` — a dead holder),
 * `stopping` (a stop is pending: wait for it), or `busy` (a turn is running).
 */
export function turnLockState(
  expiresAtMs: number | undefined,
  stopRequestedAtMs: number | undefined,
  nowMs: number,
  stopWaitMs: number
): "free" | "busy" | "stopping" {
  if (expiresAtMs === undefined || expiresAtMs <= nowMs) return "free"
  if (stopRequestedAtMs === undefined) return "busy"
  return nowMs - stopRequestedAtMs > stopWaitMs ? "free" : "stopping"
}
