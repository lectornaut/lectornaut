/**
 * Pure privacy decisions for chats, memories and per-member workflow runs.
 * No I/O, so `privacyCore.test.mjs` runs them offline.
 */

import {
  ADMIN_VIEW_TTL_MS,
  CONNECTION_TOOL_NAMES,
} from "@lectornaut/shared/domain"

const CONNECTION_TOOL_NAME_SET: ReadonlySet<string> = new Set(
  CONNECTION_TOOL_NAMES
)

/** True for any tool that reads or writes a member's connected account. */
export function isConnectionToolName(name: string | undefined): boolean {
  return !!name && CONNECTION_TOOL_NAME_SET.has(name)
}

interface ThreadMessageLike {
  content?: readonly { toolRequest?: { name?: string } }[]
}

/** True when any message in the thread called a connection tool. */
export function threadUsedConnectionTool(
  thread: readonly ThreadMessageLike[] | undefined
): boolean {
  return (thread ?? []).some((m) =>
    (m.content ?? []).some((p) => isConnectionToolName(p.toolRequest?.name))
  )
}

/**
 * May this turn register connection tools? They act through the SENDER's
 * personal accounts, so in a chat the sender does not own the result lands in
 * someone else's transcript: that needs the sender's explicit go-ahead
 * (`consented`, set by the client's confirm). Headless runs (`userUid` null)
 * are validated by the workflow worker instead.
 */
export function connectionsAllowedForTurn(opts: {
  userUid: string | null
  sessionOwnerUid: string
  consented: boolean
}): boolean {
  return (
    opts.userUid === null ||
    opts.userUid === opts.sessionOwnerUid ||
    opts.consented
  )
}

/**
 * Messages after which a per-member workflow run starts a new chat instead
 * of continuing the ongoing one, so its history (and each run's input) stays
 * bounded.
 */
export const RUN_SESSION_MAX_MESSAGES = 200

/**
 * Where a per-member workflow run puts its turn:
 *   - `new`: no usable chat (deleted, archived, re-owned) or the ongoing one
 *     is full, so start a fresh one.
 *   - `skip`: the member is mid-turn in it (a reply running, or a question
 *     waiting on their answer); the run must not write over that.
 *   - `continue`: append to the ongoing chat.
 * `busy` is only consulted for a chat that would otherwise be continued.
 */
export function runSessionPlan(
  session: { ownerUid: string; archived: boolean; messageCount: number } | null,
  forUid: string,
  busy: boolean
): "continue" | "new" | "skip" {
  if (!session || session.archived || session.ownerUid !== forUid) return "new"
  if (session.messageCount >= RUN_SESSION_MAX_MESSAGES) return "new"
  return busy ? "skip" : "continue"
}

/** Is a "view as admin" grant still live? Mirrors the rules' expiry check. */
export function adminViewActive(
  expiresAtMs: number | null | undefined,
  nowMs: number
): boolean {
  return typeof expiresAtMs === "number" && expiresAtMs > nowMs
}

export const adminViewExpiry = (nowMs: number): number =>
  nowMs + ADMIN_VIEW_TTL_MS
