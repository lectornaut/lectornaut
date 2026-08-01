/**
 * Pure outbox-queue algebra for the sync engine.
 *
 * This module is deliberately free of Firebase, Vue, and DOM dependencies so
 * the scheduling and merge logic can be unit-tested in isolation and reasoned
 * about without the engine's stateful machinery. `firebase-sync-engine.ts`
 * owns all the side effects — listeners, timers, localStorage, Firestore
 * writes — and delegates the "what should happen next" decisions here.
 */
import {
  syncOutboxOperationSchema,
  type SyncOutboxOperation,
} from "@/schemas/sync"

/** Retention for settled (acked/rejected) ops before they are pruned. */
export const OUTBOX_SETTLED_RETENTION_MS = 60 * 60 * 1000

/**
 * Base delay before an in-flight ("sent") operation becomes eligible to retry.
 * A retry re-invokes the `applySyncOperation` callable (idempotent — the
 * server only processes still-pending ops), so this is really an ACK timeout:
 * it must comfortably cover a warm end-to-end settle AND most function cold
 * starts, otherwise retries fire against a backend that is merely slow.
 */
export const OUTBOX_RETRY_BASE_DELAY_MS = 3_000

/**
 * Hard cap on settlement attempts before an operation is parked. With the
 * engine's exponential backoff (3s base, capped at 30s) a genuinely
 * unreachable backend stops sending after roughly 45s — rather than retrying
 * a doomed write forever. Parking is not terminal: the waiter stays pending
 * and resume triggers restart the budget (see `resumeParkedOperations`).
 * Attempts only burn while online (the loop is gated on `isOnline`), so an
 * offline outbox never consumes this budget.
 */
export const OUTBOX_MAX_ATTEMPTS = 4

/**
 * Base delay before re-invoking the callable after a DETECTED transport
 * failure. Much tighter than `OUTBOX_RETRY_BASE_DELAY_MS`: that ladder is an
 * ack timeout sized for a backend that may merely be slow, whereas here the
 * invocation already failed — waiting out the full window would add ~3s of
 * pure lag to every recoverable blip.
 */
export const OUTBOX_FAST_RETRY_BASE_DELAY_MS = 300

/** Unsettled = still owed a server verdict (pending, in flight, or parked). */
export const isUnsettledOperation = (operation: SyncOutboxOperation): boolean =>
  operation.status === "pending" ||
  operation.status === "sent" ||
  operation.status === "parked"

const isUnsettled = isUnsettledOperation

const isSettled = (operation: SyncOutboxOperation): boolean =>
  operation.status === "acked" || operation.status === "rejected"

/**
 * Drop the write payload from a SETTLED entry. Settled rows are only retained
 * (for `OUTBOX_SETTLED_RETENTION_MS`) so duplicate verdicts dedupe and the
 * metrics counters stay honest — both need ids and status, never the data —
 * while an hour of heavy collab saves (~1MB base64 snapshot payloads, doubled
 * by localStorage's UTF-16) would blow the ~5MB quota and silently kill
 * outbox durability mid-session. `data` and `baseVersion` are removed
 * outright (not set to `undefined`) so the persisted JSON carries no trace;
 * both fields are optional in `syncOutboxOperationSchema`, so stripped
 * entries and old fat entries parse alike. Unsettled entries pass through
 * untouched — their payload is still owed to the server.
 */
export const stripSettledOperationPayload = (
  operation: SyncOutboxOperation
): SyncOutboxOperation => {
  if (!isSettled(operation)) return operation
  if (operation.data === undefined && operation.baseVersion === undefined) {
    return operation
  }
  const { data, baseVersion, ...stripped } = operation
  return stripped
}

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
 * re-sent once its backoff window elapses — unless a detected callable
 * failure pulled its eligibility forward via `nextEligibleAt`, in which case
 * the earlier of the two wins (never later: the ladder is the ceiling).
 * The window is measured from `sentAt`, which the engine stamps only on FULL
 * (ladder) attempts — fast retries never restart the backoff clock.
 * `retryDelayFor` is injected so the engine can supply its jittered backoff
 * while tests stay deterministic.
 */
export const computeRetryInMs = (
  operation: SyncOutboxOperation,
  now: number,
  retryDelayFor: (attempts: number) => number
): number => {
  if (operation.status !== "sent" || operation.sentAt == null) return 0
  const ladderReadyAt = operation.sentAt + retryDelayFor(operation.attempts)
  const readyAt =
    operation.nextEligibleAt != null
      ? Math.min(ladderReadyAt, operation.nextEligibleAt)
      : ladderReadyAt
  return Math.max(0, readyAt - now)
}

/**
 * Delay before the next fast retry: doubles per consecutive detected failure
 * and is capped by the ladder delay for the op's current attempt count, so a
 * persistently failing callable degenerates into the normal ladder instead of
 * hammering it.
 */
export const computeFastRetryDelay = (
  fastRetries: number,
  ladderDelayMs: number
): number =>
  Math.min(
    OUTBOX_FAST_RETRY_BASE_DELAY_MS * 2 ** Math.max(fastRetries, 0),
    ladderDelayMs
  )

/**
 * Whether a send firing now counts against the attempt budget. First sends
 * and ladder-due retries do; a fast retry (re-sent before its ladder window
 * opened, via `nextEligibleAt`) does not — otherwise a burst of detected
 * callable failures would burn the ~45s budget in a couple of seconds. An op
 * without `nextEligibleAt` is always a full attempt: only a detected failure
 * pulls eligibility forward, so a plain ladder retry must burn its attempt
 * even when the (jittered) delay is re-sampled larger than the elapsed wait.
 * Like `computeRetryInMs`, the window is measured from `sentAt` = the last
 * FULL attempt: because fast sends never restamp it, a run of fast retries
 * cannot stretch the ladder and the budget still exhausts in ~45s of pure
 * ladder time (modulo the ladder's own jitter).
 */
export const isFullAttemptSend = (
  operation: SyncOutboxOperation,
  now: number,
  retryDelayFor: (attempts: number) => number
): boolean =>
  operation.status !== "sent" ||
  operation.sentAt == null ||
  operation.nextEligibleAt == null ||
  now - operation.sentAt >= retryDelayFor(operation.attempts)

export interface ReadySyncWork {
  /**
   * Up to `limit` operations ready to send right now, in causal order, at
   * most one per `targetPath`. Empty when nothing is currently eligible.
   */
  ready: SyncOutboxOperation[]
  /**
   * When operations are still backing off, the soonest delay (ms) after which
   * one becomes ready — so the caller can schedule a wake-up instead of
   * stalling. Null when there is genuinely nothing waiting.
   */
  nextRetryInMs: number | null
}

/** Shared empty in-flight set for callers with no live sends to exclude. */
const NO_IN_FLIGHT: ReadonlySet<string> = new Set()

/**
 * Pick the operations to send for `userId` this pass, preserving two
 * invariants:
 *
 *  1. **Per-path FIFO** — only the earliest unsettled op on a given
 *     `targetPath` may run; later same-path ops wait behind it so writes to
 *     one document never reorder (a stale `set` must not land after a newer
 *     one, a `delete` must not overtake the `set` it follows, etc.).
 *  2. **No cross-path head-of-line blocking** — an op that is mid-backoff does
 *     not stall ready ops on *other* paths. We skip it and report when it
 *     becomes ready via `nextRetryInMs`.
 *
 * Distinct-path heads are independent, so the engine sends the returned batch
 * concurrently — a burst of N ops on N documents costs one round trip of
 * wall-clock instead of N. Ready ops beyond `limit` are left for the next
 * pass (the engine reschedules immediately after a send), so they neither
 * register a wake-up nor get dropped.
 *
 * Ops in `inFlightIds` (their send promise is still outstanding) keep their
 * path claim — per-path FIFO holds while the live send races its verdict —
 * but never enter `ready` and never consume a `limit` slot: their send IS
 * the in-flight slot. Without this, a hung send (a lie-fi `setDoc` promise
 * that never resolves) whose ladder window elapsed would look "ready", fill
 * the slots before any in-flight filtering, and starve every other path's
 * dispatch with no wake. A mid-backoff in-flight op still reports its ladder
 * wake — harmless: the woken pass re-plans against the then-current set.
 *
 * Scans in causal (array) order, so the returned ops are the oldest eligible
 * ones. O(n) with a small Set.
 */
export const selectReadyOperations = (
  operations: readonly SyncOutboxOperation[],
  userId: string,
  now: number,
  retryDelayFor: (attempts: number) => number,
  limit: number,
  inFlightIds: ReadonlySet<string> = NO_IN_FLIGHT
): ReadySyncWork => {
  const claimedPaths = new Set<string>()
  const ready: SyncOutboxOperation[] = []
  let nextRetryInMs: number | null = null

  for (const operation of operations) {
    if (operation.userId !== userId || !isUnsettled(operation)) continue

    // Invariant 1: an earlier unsettled op already owns this path this round.
    if (claimedPaths.has(operation.targetPath)) continue
    claimedPaths.add(operation.targetPath)

    // Parked ops still own their path (per-path FIFO must hold across a
    // park/resume cycle) but never send from here — resumption is event-driven
    // (online / visibility / engine start / slow timer), not backoff-polled.
    if (operation.status === "parked") continue

    const retryInMs = computeRetryInMs(operation, now, retryDelayFor)
    if (retryInMs === 0) {
      // In flight and ladder-due: the path claim above stands, but the op is
      // neither re-dispatchable nor a capacity consumer (see the doc above).
      // No wake either — a completing send always triggers the next pass.
      if (inFlightIds.has(operation.id)) continue
      if (ready.length < limit) {
        ready.push(operation)
      }
      // Over the cap: ready now, picked up next pass — no wake-up needed.
      continue
    }

    // Invariant 2: backing off — remember the soonest wake and keep scanning
    // other paths for something ready right now.
    if (nextRetryInMs === null || retryInMs < nextRetryInMs) {
      nextRetryInMs = retryInMs
    }
  }

  return { ready, nextRetryInMs }
}

/**
 * True once an op has exhausted its send attempts without a server verdict
 * and must be parked (waiter pending, optimistic state kept) until a resume
 * trigger. Never a terminal failure: under lie-fi the op doc's write may
 * still commit and settle server-side once real connectivity returns.
 */
export const shouldPark = (operation: SyncOutboxOperation): boolean =>
  operation.attempts >= OUTBOX_MAX_ATTEMPTS

export interface DispatchPlan {
  /** Ops to dispatch now, in causal order, within the in-flight capacity. */
  dispatch: SyncOutboxOperation[]
  /** Ready ops that exhausted their budget — park instead of sending. */
  park: SyncOutboxOperation[]
  /** Soonest backoff wake (ms), as reported by `selectReadyOperations`. */
  nextRetryInMs: number | null
}

/**
 * Plan one dispatch pass under PER-OP in-flight tracking (the replacement for
 * the whole-loop send barrier): `maxParallelSends` caps TOTAL in-flight sends
 * across all paths, so one slow send (a ~1MB snapshot create) no longer holds
 * every other path's dispatch hostage — a distinct-path enqueue goes out
 * immediately while capacity remains, and each completion frees a slot for
 * the next pass.
 *
 * Selection invariants are inherited from `selectReadyOperations` (per-path
 * FIFO, no cross-path head-of-line blocking, parked exclusion, ladder /
 * `nextEligibleAt` fast-retry timing). Selection is in-flight-aware: ops
 * already in flight are never re-dispatched — even if a peer-tab merge or a
 * due `nextEligibleAt` makes them look ready mid-send — so overlapping
 * passes cannot double-send, and (crucially) they never consume a capacity
 * slot, so hung sends cannot starve other paths' ready work. With no
 * capacity the pass is a no-op (no wake either: a completing send always
 * triggers the next pass).
 */
export const planDispatch = (
  operations: readonly SyncOutboxOperation[],
  userId: string,
  now: number,
  retryDelayFor: (attempts: number) => number,
  inFlightIds: ReadonlySet<string>,
  maxParallelSends: number
): DispatchPlan => {
  const capacity = maxParallelSends - inFlightIds.size
  if (capacity <= 0) {
    return { dispatch: [], park: [], nextRetryInMs: null }
  }

  const { ready, nextRetryInMs } = selectReadyOperations(
    operations,
    userId,
    now,
    retryDelayFor,
    capacity,
    inFlightIds
  )

  const dispatch: SyncOutboxOperation[] = []
  const park: SyncOutboxOperation[] = []
  for (const operation of ready) {
    if (shouldPark(operation)) {
      park.push(operation)
    } else {
      dispatch.push(operation)
    }
  }

  return { dispatch, park, nextRetryInMs }
}

/**
 * Flip a user's parked ops back to sendable: status → pending with a fresh
 * attempt budget, so a resume trigger (online / visible / engine start / slow
 * timer) restarts the full ladder instead of instantly re-parking. Returns
 * the original array reference when the user has nothing parked so callers
 * can short-circuit.
 */
export const resumeParkedOperations = (
  operations: SyncOutboxOperation[],
  userId: string,
  now: number
): SyncOutboxOperation[] => {
  const isParkedForUser = (operation: SyncOutboxOperation) =>
    operation.userId === userId && operation.status === "parked"
  if (!operations.some(isParkedForUser)) return operations

  return operations.map((operation) =>
    isParkedForUser(operation)
      ? {
          ...operation,
          status: "pending" as const,
          attempts: 0,
          fastRetries: undefined,
          nextEligibleAt: undefined,
          sentAt: undefined,
          parkedAt: undefined,
          updatedAt: now,
        }
      : operation
  )
}

const isPlainMap = (value: unknown): boolean =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Whether folding `incoming` over `existing` with a shallow spread would
 * diverge from the server's `merge: true` set semantics. Firestore
 * deep-merges nested maps field-by-field, so for a shared top-level key whose
 * INCOMING value is a plain map the coalesced spread is not equivalent to
 * applying the two writes in sequence:
 *
 *  - map in BOTH payloads — the spread replaces the earlier map wholesale
 *    (coalescing `{prefs:{a:1}}` then `{prefs:{b:2}}` destroys `a`), while
 *    the server would deep-merge both;
 *  - scalar/array then map — the sequential writes first REPLACE the target
 *    field (wiping any pre-existing server map) and then merge the partial
 *    map into that scalar, while the coalesced spread deep-merges the map
 *    over whatever the server document still holds.
 *
 * Shared keys whose incoming value is a scalar or an array are safe: the
 * spread's replacement is exactly Firestore's field replacement. The check is
 * therefore asymmetric — only the incoming side's shape matters (an earlier
 * map replaced by an incoming scalar coalesces fine).
 */
export const hasConflictingNestedMergeKey = (
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined
): boolean => {
  if (!existing || !incoming) return false
  for (const [key, incomingValue] of Object.entries(incoming)) {
    if (!(key in existing)) continue
    if (isPlainMap(incomingValue)) return true
  }
  return false
}

/**
 * How the `firebase/functions` SDK surfaces the server's `HttpsError`
 * "not-found": a `FirebaseError` with a namespaced `code`. Matched
 * structurally (not via `instanceof`) so this module keeps its
 * no-Firebase-imports rule.
 */
const FUNCTIONS_NOT_FOUND_CODE = "functions/not-found"

/**
 * True when a failed `applySyncOperation` invocation is a DEFINITIVE terminal
 * disposition rather than a transient transport error. A callable "not-found"
 * means the op doc does not exist server-side; for an op whose create WAS
 * acknowledged (`remoteCreated`) the only way that happens is that the doc
 * was settled + TTL-swept (this client missed the verdict) or orphan-swept —
 * no verdict can ever arrive, so retrying/parking would pin the op (and,
 * via per-path FIFO, every later write to its target) forever. The engine
 * settles such ops client-side as rejected through the normal verdict path.
 */
export const isDefinitiveNotFound = (
  error: unknown,
  operation: SyncOutboxOperation
): boolean =>
  operation.remoteCreated === true &&
  isUnsettled(operation) &&
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code: unknown }).code === FUNCTIONS_NOT_FOUND_CODE

/**
 * The payload-carry mirror of `isDefinitiveNotFound`: a callable "not-found"
 * for an op whose op doc was NEVER created (`remoteCreated` false) means the
 * deployed server predates payload carry — its narrower input schema stripped
 * the carried `operation` and it looked up a doc that does not exist. Not a
 * failure: the engine downgrades to the setDoc path (create the op doc, then
 * re-invoke), the contract the old server understands. Only unsettled ops
 * qualify; a not-found WITH `remoteCreated` stays the terminal disposition
 * `isDefinitiveNotFound` owns.
 */
export const isOldServerPayloadCarryNotFound = (
  error: unknown,
  operation: SyncOutboxOperation
): boolean =>
  operation.remoteCreated !== true &&
  isUnsettled(operation) &&
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code: unknown }).code === FUNCTIONS_NOT_FOUND_CODE

/**
 * Firestore write-error codes from the op-doc `setDoc` that count as a server
 * VERDICT even though no settlement doc exists: rules evaluation
 * (`permission-denied`), argument validation (`invalid-argument`), and
 * precondition checks (`failed-precondition`) are deterministic functions of
 * the op's own payload and target state — a retry can only fail the same way,
 * so rejecting now matches the verdict the server would hand down. Every
 * other code (`unauthenticated`, `unknown`, anything outside the retryable
 * set) is ambiguous — no verdict happened and a retry may succeed — and must
 * ride the retry ladder and park like other verdict-less failures.
 */
export const isVerdictEquivalentSubmissionCode = (
  code: string | null
): boolean =>
  code === "permission-denied" ||
  code === "invalid-argument" ||
  code === "failed-precondition"

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

// Higher rank = further along the lifecycle / more authoritative. "parked"
// shares the "sent" rank: a park/resume cycle is not monotonic (resume flips
// parked back to pending), so between a peer's stale "sent" and a fresh
// "parked" — or a fresh post-resume "sent" and a stale "parked" — the
// `updatedAt` tiebreak in `pickFresher` decides. A resumed op is only
// "pending" for one send pass, so a stale parked peer copy briefly winning
// over it self-heals on the next resume trigger.
const statusRank = (operation: SyncOutboxOperation): number => {
  switch (operation.status) {
    case "pending":
      return 0
    case "sent":
    case "parked":
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
 * Convert an outbox snapshot to the shape persisted at the shared localStorage
 * key. "parked" is purely in-memory: older app versions read the same key
 * with a stricter status enum and quarantine-and-drop entries they cannot
 * parse — their next flush rewrites the key without the op, silently losing
 * the write during a version-overlap window (desktop builds lag web deploys).
 * Parked ops are therefore demoted to "pending" with their exhausted attempt
 * count intact: this version re-parks them on the first loop pass
 * (`shouldPark` fires before any send), and old versions just see ordinary
 * pending work. `parkedAt` is stripped along with the status so nothing
 * persisted ever carries a trace of the parked state.
 *
 * Settled entries persist payload-less (`stripSettledOperationPayload`): the
 * engine already strips at settlement time, so this is the boundary backstop
 * for fat settled rows adopted from an old-version peer's snapshot — they
 * must not re-inflate the stored outbox for their whole retention hour.
 */
export const toPersistedOperations = (
  operations: readonly SyncOutboxOperation[]
): SyncOutboxOperation[] =>
  operations.map((operation) =>
    operation.status === "parked"
      ? { ...operation, status: "pending" as const, parkedAt: undefined }
      : stripSettledOperationPayload(operation)
  )

/**
 * Decide what one persist flush writes. The read-modify-write merge against
 * the stored localStorage copy exists solely for multi-tab convergence, but
 * it costs a `JSON.parse` plus a per-entry Zod `safeParse` of the entire
 * stored outbox on EVERY flush. The skip is SELF-VERIFYING: it fires only
 * when the stored copy (`storedRaw`) is byte-identical to the exact string
 * this tab last wrote (`lastWrittenRaw`) — one string equality, far cheaper
 * than the parse+Zod pass it avoids. A 'storage'-event dirty flag alone
 * cannot be trusted here: the event is async (a peer write can land between
 * its last delivery and a debounced flush) and is never delivered to — nor
 * replayed for — bfcache'd documents, and a skipped merge blindly overwrites
 * a peer tab's unsent ops. A null `lastWrittenRaw` (nothing written yet this
 * session) always merges. `parseStored` is a thunk so the skip also skips
 * the parse.
 */
export const planOutboxPersist = (
  snapshot: SyncOutboxOperation[],
  storedRaw: string | null,
  lastWrittenRaw: string | null,
  parseStored: (raw: string) => SyncOutboxOperation[],
  now: number
): SyncOutboxOperation[] =>
  lastWrittenRaw !== null && storedRaw === lastWrittenRaw
    ? snapshot
    : mergeOutboxSnapshots(
        snapshot,
        storedRaw === null ? [] : parseStored(storedRaw),
        now
      )

/**
 * Lower bound (epoch ms) for the ack listener's remote `createdAt` filter:
 * `min(oldest unsettled op createdAt, now - OUTBOX_SETTLED_RETENTION_MS)`,
 * recomputed with a fresh `nowMs` on every (re)attach. Without a bound, a
 * cold boot with a stale resume token re-bills a read per RETAINED remote op
 * doc just to replay verdicts the client already applied. The bound must
 * NEVER exclude an op the client still holds unsettled — parked ops can be
 * arbitrarily old, so the oldest live op's `createdAt` dominates whenever it
 * predates the retention window. The `now - retention` floor does two jobs:
 * it covers verdict-dedup for every settled entry the outbox still retains
 * (settled entries prune on the same clock), and it gives a full retention
 * window of clock-skew slack for fresh ops — remote `createdAt` is a server
 * timestamp while the local one is client-clock millis, so a client clock
 * running ahead could otherwise exclude a fresh op's own doc. For an
 * hour-plus-old unsettled op the local `createdAt` itself is the bound;
 * residual skew there is recoverable — the listener is a backstop, and a
 * ladder retry re-invokes the callable, which returns the stored verdict for
 * an already-settled doc.
 */
export const computeAckHorizonMillis = (
  operations: readonly SyncOutboxOperation[],
  userId: string,
  nowMs: number
): number => {
  let horizon = nowMs - OUTBOX_SETTLED_RETENTION_MS
  for (const operation of operations) {
    if (operation.userId !== userId || !isUnsettled(operation)) continue
    if (operation.createdAt < horizon) horizon = operation.createdAt
  }
  return horizon
}

/** One row of the dead-letter quarantine ring, normalized for display. */
export interface QuarantinedOutboxEntry {
  /** When the entry was quarantined (epoch ms), when the record carried it. */
  quarantinedAt: number | null
  /** The quarantined value itself, exactly as stored — possibly corrupt. */
  entry: unknown
}

/**
 * Normalize raw quarantine-ring records to a uniform shape. The engine wraps
 * every quarantined value as `{ quarantinedAt, entry }`, but the ring is
 * plain localStorage JSON, so anything unexpected degrades to a bare entry
 * with no timestamp rather than being dropped.
 */
export const toQuarantinedOutboxEntries = (
  records: readonly unknown[]
): QuarantinedOutboxEntry[] =>
  records.map((record) => {
    if (typeof record === "object" && record !== null && "entry" in record) {
      const { quarantinedAt } = record as { quarantinedAt?: unknown }
      return {
        quarantinedAt: typeof quarantinedAt === "number" ? quarantinedAt : null,
        entry: (record as { entry: unknown }).entry,
      }
    }
    return { quarantinedAt: null, entry: record }
  })

export interface QuarantineRequeueCandidate {
  /** The parsed operation, safe to hand back to the enqueue path. */
  operation: SyncOutboxOperation
  /**
   * The originating raw ring record, exactly as stored — so a candidate whose
   * re-enqueue FAILS (path-schema validation, full queue) can be kept
   * quarantined instead of dropped.
   */
  record: unknown
}

export interface QuarantineRequeuePlan {
  /**
   * Candidates that parse under the CURRENT outbox schema, are unsettled,
   * and belong to `userId` — eligible for re-enqueue as fresh writes.
   */
  requeue: QuarantineRequeueCandidate[]
  /** Raw ring records to leave quarantined (corrupt, settled, other users). */
  keep: unknown[]
}

/**
 * Partition the quarantine ring for a re-enqueue pass. An entry qualifies for
 * requeue only when it parses under the CURRENT schema (entries quarantined
 * by an OLDER version's stricter schema — e.g. a pre-`parked` build — often
 * do), is still unsettled (a settled entry's write already has a verdict;
 * replaying it would double-apply), and belongs to `userId` (the engine
 * enqueues under the ACTIVE user, so another account's write must never be
 * replayed here). Everything else is kept untouched — corrupt rows retain
 * their forensic value. Duplicate ids (the same op quarantined by two tabs)
 * are requeued once and the extra copies dropped. Each candidate carries its
 * raw ring record so the engine can keep it quarantined when the actual
 * re-enqueue (payload validation, capacity) fails.
 */
export const planQuarantineRequeue = (
  records: readonly unknown[],
  userId: string
): QuarantineRequeuePlan => {
  const requeue: QuarantineRequeueCandidate[] = []
  const keep: unknown[] = []
  const seen = new Set<string>()

  for (const record of records) {
    const [normalized] = toQuarantinedOutboxEntries([record])
    const parsed = syncOutboxOperationSchema.safeParse(normalized?.entry)
    if (
      !parsed.success ||
      parsed.data.userId !== userId ||
      !isUnsettled(parsed.data)
    ) {
      keep.push(record)
      continue
    }
    if (seen.has(parsed.data.id)) continue
    seen.add(parsed.data.id)
    requeue.push({ operation: parsed.data, record })
  }

  return { requeue, keep }
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
