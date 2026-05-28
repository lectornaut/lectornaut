/**
 * Pure outbox-queue algebra for the sync engine.
 *
 * This module is deliberately free of Firebase, Vue, and DOM dependencies so
 * the scheduling and merge logic can be unit-tested in isolation and reasoned
 * about without the engine's stateful machinery. `firebase-sync-engine.ts`
 * owns all the side effects — listeners, timers, localStorage, Firestore
 * writes — and delegates the "what should happen next" decisions here.
 */
import type { SyncOutboxOperation } from "@/schemas/sync"

/** Retention for settled (acked/rejected) ops before they are pruned. */
export const OUTBOX_SETTLED_RETENTION_MS = 60 * 60 * 1000

/**
 * Hard cap on send attempts before an operation is dead-lettered. With the
 * engine's exponential backoff (1s base, capped at 30s) this works out to a
 * couple of minutes of retrying before we give up — rather than retrying a
 * doomed write forever, which would also head-of-line-block its path.
 */
export const OUTBOX_MAX_ATTEMPTS = 8

const isUnsettled = (operation: SyncOutboxOperation): boolean =>
  operation.status === "pending" || operation.status === "sent"

const isSettled = (operation: SyncOutboxOperation): boolean =>
  operation.status === "acked" || operation.status === "rejected"

/**
 * Stable causal ordering: creation time, then id as a deterministic tiebreak.
 * Mirrors enqueue order so per-path FIFO is preserved across reloads/merges.
 */
export const compareByCreatedOrder = (
  a: SyncOutboxOperation,
  b: SyncOutboxOperation
): number => {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  return a.id.localeCompare(b.id)
}

/**
 * Milliseconds until `operation` is eligible to (re)send. Pending ops are
 * ready immediately (0); a "sent" op is awaiting its ack and may only be
 * re-sent once its backoff window elapses. `retryDelayFor` is injected so the
 * engine can supply its jittered backoff while tests stay deterministic.
 */
export const computeRetryInMs = (
  operation: SyncOutboxOperation,
  now: number,
  retryDelayFor: (attempts: number) => number
): number => {
  if (operation.status !== "sent" || operation.sentAt == null) return 0
  const elapsed = now - operation.sentAt
  return Math.max(0, retryDelayFor(operation.attempts) - elapsed)
}

export interface NextSyncWork {
  /** The oldest operation ready to send right now, or null if none. */
  ready: SyncOutboxOperation | null
  /**
   * When `ready` is null but operations are still backing off, the soonest
   * delay (ms) after which one becomes ready — so the caller can schedule a
   * wake-up instead of stalling. Null when there is genuinely nothing to do.
   */
  nextRetryInMs: number | null
}

/**
 * Pick the next operation to send for `userId`, preserving two invariants:
 *
 *  1. **Per-path FIFO** — only the earliest unsettled op on a given
 *     `targetPath` may run; later same-path ops wait behind it so writes to
 *     one document never reorder (a stale `set` must not land after a newer
 *     one, a `delete` must not overtake the `set` it follows, etc.).
 *  2. **No cross-path head-of-line blocking** — an op that is mid-backoff does
 *     not stall ready ops on *other* paths. We skip it and report when it
 *     becomes ready via `nextRetryInMs`.
 *
 * Scans in causal (array) order, so the returned op is the oldest eligible
 * one. O(n) with a small Set.
 */
export const selectNextOperation = (
  operations: readonly SyncOutboxOperation[],
  userId: string,
  now: number,
  retryDelayFor: (attempts: number) => number
): NextSyncWork => {
  const claimedPaths = new Set<string>()
  let nextRetryInMs: number | null = null

  for (const operation of operations) {
    if (operation.userId !== userId || !isUnsettled(operation)) continue

    // Invariant 1: an earlier unsettled op already owns this path this round.
    if (claimedPaths.has(operation.targetPath)) continue
    claimedPaths.add(operation.targetPath)

    const retryInMs = computeRetryInMs(operation, now, retryDelayFor)
    if (retryInMs === 0) {
      return { ready: operation, nextRetryInMs: null }
    }

    // Invariant 2: backing off — remember the soonest wake and keep scanning
    // other paths for something ready right now.
    if (nextRetryInMs === null || retryInMs < nextRetryInMs) {
      nextRetryInMs = retryInMs
    }
  }

  return { ready: null, nextRetryInMs }
}

/** True once an op has exhausted its send attempts and must be dead-lettered. */
export const shouldDeadLetter = (operation: SyncOutboxOperation): boolean =>
  operation.attempts >= OUTBOX_MAX_ATTEMPTS

const isExpiredSettled = (
  operation: SyncOutboxOperation,
  now: number
): boolean => {
  if (!isSettled(operation)) return false
  const settledAt = operation.settledAt ?? operation.updatedAt
  return now - settledAt > OUTBOX_SETTLED_RETENTION_MS
}

/**
 * Drop settled operations past the retention window. Returns the original
 * array reference when nothing expired so reactive consumers can short-circuit
 * (this is called on every ack snapshot). `filter` only ever removes, so an
 * equal length means nothing changed.
 */
export const pruneExpiredOperations = (
  operations: SyncOutboxOperation[],
  now: number
): SyncOutboxOperation[] => {
  const next = operations.filter(
    (operation) => !isExpiredSettled(operation, now)
  )
  return next.length === operations.length ? operations : next
}

// Higher rank = further along the (monotonic) lifecycle / more authoritative.
const statusRank = (operation: SyncOutboxOperation): number => {
  switch (operation.status) {
    case "pending":
      return 0
    case "sent":
      return 1
    case "acked":
    case "rejected":
      return 2
  }
}

/**
 * Choose the more-progressed of two records for the same operation id. Status
 * advances monotonically (pending → sent → acked/rejected), so the higher
 * status rank is the more recent truth; ties break on `updatedAt` then
 * `attempts`, finally preferring `a` for determinism.
 */
const pickFresher = (
  a: SyncOutboxOperation,
  b: SyncOutboxOperation
): SyncOutboxOperation => {
  const rankDelta = statusRank(a) - statusRank(b)
  if (rankDelta !== 0) return rankDelta > 0 ? a : b
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  if (a.attempts !== b.attempts) return a.attempts > b.attempts ? a : b
  return a
}

/**
 * Merge two outbox snapshots (e.g. this tab's in-memory queue and the copy a
 * peer tab just wrote to the shared localStorage key) into one convergent view.
 *
 * Union by operation id with `pickFresher` resolving per-id conflicts, then
 * expired-settled rows are pruned so the merge agrees with `pruneExpired`
 * rather than resurrecting aged ones. Deterministic and idempotent: merging
 * already-converged snapshots yields an equal result, so the engine's equality
 * guard stops any cross-tab storage-event ping-pong.
 *
 * NOTE: union-merge has no delete semantics. A deliberate, non-expiry removal
 * on one tab (e.g. `clearOutboxForUser` on account switch) can be re-added from
 * a peer's snapshot. Such rows are inert — they only send while their user is
 * active and are bounded by the per-user pending cap. A full fix would need
 * tombstones or single-writer leader election.
 */
export const mergeOutboxSnapshots = (
  mine: SyncOutboxOperation[],
  other: SyncOutboxOperation[],
  now: number
): SyncOutboxOperation[] => {
  if (other.length === 0) return pruneExpiredOperations(mine, now)

  const byId = new Map<string, SyncOutboxOperation>()
  for (const operation of other) byId.set(operation.id, operation)
  for (const operation of mine) {
    const existing = byId.get(operation.id)
    byId.set(
      operation.id,
      existing ? pickFresher(existing, operation) : operation
    )
  }

  const merged: SyncOutboxOperation[] = []
  for (const operation of byId.values()) {
    if (!isExpiredSettled(operation, now)) merged.push(operation)
  }
  merged.sort(compareByCreatedOrder)
  return merged
}

/**
 * Shallow identity check for two outbox snapshots — same ids in the same order
 * carrying the same status/updatedAt/attempts. Lets the engine skip a reactive
 * write (and re-persist) when a merge produced no observable change.
 */
export const outboxSnapshotsEqual = (
  a: SyncOutboxOperation[],
  b: SyncOutboxOperation[]
): boolean => {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index++) {
    const x = a[index]
    const y = b[index]
    if (
      !x ||
      !y ||
      x.id !== y.id ||
      x.status !== y.status ||
      x.updatedAt !== y.updatedAt ||
      x.attempts !== y.attempts
    ) {
      return false
    }
  }
  return true
}
