import { generateId } from "@/helpers/utilities"
import { auth, firestore, functions } from "@/modules/firebase"
import { lookupSchema } from "@/schemas/_registry"
import { assertValid, validatePartialUpdate } from "@/schemas/_utils"
import {
  syncOutboxOperationSchema,
  type SyncMutatePayload,
  type SyncOutboxOperation,
} from "@/schemas/sync"
import type { SyncBaseVersion, SyncMutationType } from "@/types/sync"
import {
  FirestoreErrorCodes,
  getFirestoreErrorMessage,
  hasFirebaseErrorCode,
} from "@/utils/firebase/firebase-errors"
import { getBackoffDelay } from "@/utils/firebase/firebase-optimistic"
import {
  compareByCreatedOrder,
  computeAckHorizonMillis,
  computeFastRetryDelay,
  hasConflictingNestedMergeKey,
  isDefinitiveNotFound,
  isFullAttemptSend,
  isOldServerPayloadCarryNotFound,
  isUnsettledOperation,
  isVerdictEquivalentSubmissionCode,
  mergeOutboxSnapshots,
  OUTBOX_RETRY_BASE_DELAY_MS,
  outboxSnapshotsEqual,
  planDispatch,
  planOutboxPersist,
  planQuarantineRequeue,
  pruneExpiredOperations,
  resumeParkedOperations,
  shouldPark,
  stripSettledOperationPayload,
  toPersistedOperations,
  toQuarantinedOutboxEntries,
  type QuarantinedOutboxEntry,
} from "@/utils/firebase/firebase-sync-queue"
import { onIdTokenChanged } from "firebase/auth"
import type { DocumentReference } from "firebase/firestore"
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  type DocumentData,
  type FieldValue,
  type Unsubscribe,
} from "firebase/firestore"
import { httpsCallable, type HttpsCallable } from "firebase/functions"
import type { ComputedRef } from "vue"

const OUTBOX_STORAGE_KEY = "lectornaut.sync.outbox.v1"
const OUTBOX_QUARANTINE_STORAGE_KEY = "lectornaut.sync.outbox.quarantine.v1"
const CLIENT_ID_STORAGE_KEY = "lectornaut.sync.client.v1"
// Per-user Web Locks name. One tab per signed-in user holds this lock and acts
// as the sole sender for that user, so multiple open tabs don't double-submit
// the same operation. Scoped by user so distinct accounts in different tabs
// each get their own leader instead of starving one another.
const SYNC_LEADER_LOCK_PREFIX = "lectornaut.sync.leader.v1:"
const OUTBOX_MAX_PENDING_PER_USER = 2_000
// Reschedule delay after a transient ack-listener error. Unrelated to the
// per-operation retry policy, which lives in `firebase-sync-queue.ts`
// (`OUTBOX_RETRY_BASE_DELAY_MS` / `OUTBOX_MAX_ATTEMPTS`).
const ACK_LISTENER_RETRY_DELAY_MS = 1_000
// Cap on TOTAL in-flight sends (per-op tracking, not a per-pass batch).
// Distinct-path heads are independent (per-path FIFO is enforced at selection
// time), and dispatch is per-op: a new distinct-path enqueue goes out
// immediately while capacity remains, so one slow send (a ~1MB snapshot
// create) never holds every other path's dispatch hostage.
const MAX_PARALLEL_SENDS = 4
// Canonical wait kept as a safety net for stragglers — but never blocks the
// caller promise. See `settleAckAfterCanonical` for the non-blocking semantics.
const CANONICAL_WAIT_TIMEOUT_MS = 1_500
// Coalescing window — kept tight so the first operation fires without lag.
// Subsequent operations enqueued inside the window still coalesce via
// `tryCoalesceOperation` (path-indexed, O(1)).
const SYNC_BATCH_WINDOW_MS = 25
// Debounce window for localStorage writes. Batching N updates into one JSON
// serialize + write avoids hammering the main thread during bursts of
// optimistic updates.
const OUTBOX_PERSIST_DEBOUNCE_MS = 16
// Slow periodic resume for parked ops — the safety net when no online /
// visibility edge ever fires (lie-fi never emits 'online'). The interval
// only runs while parked ops exist.
const PARKED_RESUME_INTERVAL_MS = 60_000

/**
 * Re-export so existing call sites that import these types from this file
 * continue to work. The canonical definitions live alongside the runtime
 * validation schema in `@/schemas/sync`.
 */
export type { SyncMutatePayload, SyncOutboxOperation }
/** Row shape returned by {@link listQuarantinedOutboxEntries}. */
export type { QuarantinedOutboxEntry }

interface RemoteSyncOperationDocument {
  id: string
  userId: string
  clientId: string
  source: string
  targetPath: string
  type: SyncMutationType
  data: Record<string, unknown> | null
  merge: boolean
  baseVersion: SyncBaseVersion | null
  status: "pending" | "ack" | "reject"
  attempts: number
  createdAt: FieldValue
  createdAtClient: number
  updatedAtClient: number
  sentAtClient: number | null
  ack: {
    code: string | null
    message: string | null
    atMs: number | null
    /**
     * Written by new-server settlements: the target document's
     * post-settlement `updatedAt` (epoch ms) when the settlement stamped
     * one. Optional so docs settled by an old deploy still parse.
     */
    updatedAtMillis?: number | null
  } | null
}

/**
 * Payload-carry wire shape: the remote op-doc fields the client would
 * otherwise write via `setDoc`, minus the fields the server owns
 * (`createdAt` is stamped server-side; `ack` is only ever written by a
 * settler). Carried on FIRST sends only (`remoteCreated` false) so the
 * server can create-if-absent and settle in one transaction; retries of a
 * created doc must invoke without it, keeping the P0 terminal not-found
 * disposition intact (a swept doc must never be re-created from a stale
 * payload).
 */
type CarriedSyncOperationPayload = Omit<
  RemoteSyncOperationDocument,
  "createdAt" | "ack" | "status"
> & { status: "pending" }

interface SyncEngineState {
  activeUserId: ComputedRef<string | null>
  isRunning: ComputedRef<boolean>
  isOnline: ComputedRef<boolean>
  isProcessing: ComputedRef<boolean>
  pendingCount: ComputedRef<number>
}

/**
 * Where a settlement was first observed:
 *  - `listener`   — the clientId-scoped ack `onSnapshot`
 *  - `callable`   — the `applySyncOperation` direct-settlement response
 *  - `inspect`    — the post-send-failure remote-document inspection
 *  - `deadLetter` — retired: exhausted ops now park (waiter pending, no
 *    rollback) instead of terminally failing; the key stays for the metrics
 *    shape
 * Diagnostic: a healthy deploy settles mostly via `callable`; a fleet stuck
 * on `listener` means the callable path is failing (soft) somewhere.
 */
export type SyncSettleSource =
  "listener" | "callable" | "inspect" | "deadLetter"

interface SyncMetricsState {
  outboxSize: ComputedRef<number>
  pendingCount: ComputedRef<number>
  averageAckLatencyMs: ComputedRef<number>
  totalRetries: ComputedRef<number>
  quarantineCount: ComputedRef<number>
  settledBySource: ComputedRef<Record<SyncSettleSource, number>>
}

export interface SyncAckEvent {
  operationId: string
  userId: string
  targetPath: string
  source: string
  status: "ack" | "reject"
  message: string | null
  at: number
}

export interface SyncCanonicalEvent {
  userId: string
  targetPath: string
  origin: "local" | "remote"
  operationId?: string
  at: number
}

/**
 * What an awaited mutation resolves WITH once the server acks. Additive
 * widening of the former `Promise<void>` contract — callers that ignore the
 * value keep working unchanged.
 *
 * `updatedAtMillis` is the target document's post-settlement `updatedAt`
 * (epoch ms), present when the server settlement stamped one (server-managed
 * `updatedAt` paths). Consumers can refresh an OCC base version from it
 * (`buildUpdatedAtBaseVersion`-compatible millis) without waiting for the
 * target snapshot to round-trip. Absent on verdicts from pre-carry server
 * deploys and on paths whose settlement stamps no `updatedAt`.
 */
export interface SyncMutateResult {
  status: "ack"
  updatedAtMillis?: number
}

type OperationWaiter = {
  resolve: (result: SyncMutateResult) => void
  reject: (error: Error) => void
}

type WaiterMap = Map<string, OperationWaiter[]>
type AckSubscriber = (event: SyncAckEvent) => void
type CanonicalSubscriber = (event: SyncCanonicalEvent) => void

const hasWindow = () => typeof window !== "undefined"

/**
 * Parse the outbox from localStorage using the Zod schema. Replaces a
 * hand-rolled type guard that checked ~10 fields individually. Corrupt
 * entries are quarantined by the caller (`readOutbox`).
 */
const parseOutbox = (
  raw: string | null
): { valid: SyncOutboxOperation[]; invalid: unknown[] } => {
  if (!raw) return { valid: [], invalid: [] }

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return { valid: [], invalid: [parsed] }
    }

    const valid: SyncOutboxOperation[] = []
    const invalid: unknown[] = []
    for (const entry of parsed) {
      const result = syncOutboxOperationSchema.safeParse(entry)
      if (result.success) {
        valid.push(result.data)
      } else {
        invalid.push(entry)
      }
    }

    return { valid, invalid }
  } catch {
    return { valid: [], invalid: [raw] }
  }
}

const appendQuarantinedOutboxEntries = (entries: unknown[]) => {
  if (!hasWindow() || entries.length === 0) return

  try {
    const existingRaw = window.localStorage.getItem(
      OUTBOX_QUARANTINE_STORAGE_KEY
    )
    const existing = existingRaw ? (JSON.parse(existingRaw) as unknown[]) : []
    const next = [
      ...existing,
      ...entries.map((entry) => ({
        quarantinedAt: Date.now(),
        entry,
      })),
    ]
    window.localStorage.setItem(
      OUTBOX_QUARANTINE_STORAGE_KEY,
      JSON.stringify(next.slice(-500))
    )
  } catch (error) {
    console.warn(
      "[syncEngine] Failed to persist quarantined outbox entries",
      error
    )
  }
}

const readOutbox = (): SyncOutboxOperation[] => {
  if (!hasWindow()) return []
  const { valid, invalid } = parseOutbox(
    window.localStorage.getItem(OUTBOX_STORAGE_KEY)
  )
  if (invalid.length > 0) {
    appendQuarantinedOutboxEntries(invalid)
  }
  return valid.sort(compareByCreatedOrder)
}

let pendingPersistTimer: ReturnType<typeof setTimeout> | null = null
let pendingPersistSnapshot: SyncOutboxOperation[] | null = null
// Single-tab persist fast path, SELF-VERIFYING: the exact string this tab
// last wrote to the shared outbox key. `flushOutboxPersist` skips the
// stored-copy read-modify-write (a JSON.parse + per-entry Zod safeParse on
// every flush) only when the stored value still equals this string — one
// getItem + string equality. A 'storage'-event dirty flag is NOT a safe
// gate on its own: the event is async (a peer write can land between its
// last delivery and our debounced flush) and is never delivered to — nor
// replayed for — bfcache'd documents, and a wrongly skipped merge blindly
// overwrites a peer tab's unsent parked ops. Starts null so the first flush
// always merges.
let lastWrittenOutboxRaw: string | null = null

const flushOutboxPersist = () => {
  if (pendingPersistTimer) {
    clearTimeout(pendingPersistTimer)
    pendingPersistTimer = null
  }
  const snapshot = pendingPersistSnapshot
  if (!snapshot || !hasWindow()) {
    pendingPersistSnapshot = null
    return
  }
  pendingPersistSnapshot = null
  try {
    // Read-modify-write: the outbox key is shared across tabs, so union our
    // snapshot with whatever a peer has written since our last write. A blind
    // overwrite would drop a concurrent tab's pending ops and lose them on
    // reload. Skipped only when the stored copy is verifiably untouched —
    // byte-identical to what this tab last wrote (`lastWrittenOutboxRaw`);
    // a single-tab session then pays only the stringify after its first
    // flush, and correctness never depends on storage-event delivery.
    const storedRaw = window.localStorage.getItem(OUTBOX_STORAGE_KEY)
    const merged = planOutboxPersist(
      snapshot,
      storedRaw,
      lastWrittenOutboxRaw,
      (raw) => parseOutbox(raw).valid,
      Date.now()
    )
    // Adopt the union into MEMORY too, not just storage: `merged` can carry
    // peer ops this tab never received a storage event for (events are not
    // delivered to — nor replayed for — bfcache'd documents). Without
    // adoption, a later flush's byte-identical fast path would rewrite the
    // key from memory alone and silently drop them; adoption also settles
    // local waiters for any of our ops a peer already settled.
    if (merged !== snapshot && !outboxSnapshotsEqual(merged, outbox.value)) {
      outbox.value = merged
      pathIndexDirty = true
      settleWaitersFromAdoptedVerdicts(merged)
      scheduleSync()
    }
    // Demote "parked" to "pending" at the storage boundary — the key is
    // shared with older app versions whose stricter status enum would
    // quarantine-and-drop a parked entry (see `toPersistedOperations`).
    const nextRaw = JSON.stringify(toPersistedOperations(merged))
    window.localStorage.setItem(OUTBOX_STORAGE_KEY, nextRaw)
    lastWrittenOutboxRaw = nextRaw
  } catch (error) {
    console.warn("[syncEngine] Failed to persist outbox", error)
  }
}

/**
 * Debounced localStorage write. Bursts of optimistic updates (e.g. rapid
 * keypresses, batch operations) all share a single serialize + write pass.
 * A `beforeunload`/`pagehide` listener ensures the last write is flushed
 * synchronously even if the user navigates away mid-batch.
 *
 * While the document is HIDDEN the debounce is skipped and the write lands
 * synchronously: a hidden document may never see another timer tick
 * (bfcache, discard, close), so enqueues made from later-registered
 * pagehide/visibility handlers — the tabsStore pointer tail flush, the
 * collab snapshot flush — would otherwise die with the armed timer and
 * reach neither localStorage nor the server. Batching buys nothing while
 * nothing is visible anyway.
 */
const persistOutbox = (operations: SyncOutboxOperation[]) => {
  if (!hasWindow()) return
  pendingPersistSnapshot = operations
  if (
    typeof document !== "undefined" &&
    document.visibilityState === "hidden"
  ) {
    flushOutboxPersist()
    return
  }
  if (pendingPersistTimer) return
  pendingPersistTimer = setTimeout(
    flushOutboxPersist,
    OUTBOX_PERSIST_DEBOUNCE_MS
  )
}

const createId = () => generateId()

const getOrCreateClientId = (): string => {
  if (!hasWindow()) return "server"

  const existing = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY)
  if (existing) return existing

  const generated = createId()
  window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, generated)
  return generated
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const toComparableMillis = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (value instanceof Date) return value.getTime()
  if (
    isRecord(value) &&
    "toMillis" in value &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    const millis = (value as { toMillis: () => number }).toMillis()
    return Number.isFinite(millis) ? millis : null
  }
  if (
    isRecord(value) &&
    "seconds" in value &&
    "nanoseconds" in value &&
    typeof value.seconds === "number" &&
    typeof value.nanoseconds === "number"
  ) {
    return value.seconds * 1000 + Math.floor(value.nanoseconds / 1_000_000)
  }
  return null
}

const areValuesEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true

  const leftMillis = toComparableMillis(left)
  const rightMillis = toComparableMillis(right)
  if (leftMillis != null && rightMillis != null) {
    return leftMillis === rightMillis
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false
    for (let index = 0; index < left.length; index++) {
      if (!areValuesEqual(left[index], right[index])) {
        return false
      }
    }
    return true
  }

  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false
    return leftKeys.every((key) => areValuesEqual(left[key], right[key]))
  }

  return false
}

const objectContainsSubset = (
  candidate: Record<string, unknown>,
  expected: Record<string, unknown>
): boolean => {
  const entries = Object.entries(expected)
  for (const [key, expectedValue] of entries) {
    if (expectedValue === undefined) continue
    if (!(key in candidate)) return false

    const actualValue = candidate[key]
    if (isRecord(expectedValue)) {
      if (!isRecord(actualValue)) return false
      if (!objectContainsSubset(actualValue, expectedValue)) {
        return false
      }
      continue
    }

    if (!areValuesEqual(actualValue, expectedValue)) {
      return false
    }
  }

  return true
}

const getValueAtFieldPath = (
  source: Record<string, unknown>,
  fieldPath: string
): unknown => {
  const segments = fieldPath
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)

  let cursor: unknown = source
  for (const segment of segments) {
    if (!isRecord(cursor)) return undefined
    cursor = cursor[segment]
  }
  return cursor
}

const hasExpectedData = (operation: SyncOutboxOperation): boolean =>
  Boolean(operation.data && Object.keys(operation.data).length > 0)

const isBaseVersionSatisfied = (
  data: Record<string, unknown>,
  baseVersion: SyncBaseVersion | null | undefined
): boolean => {
  if (!baseVersion || !baseVersion.field) return false

  const actualValue = getValueAtFieldPath(data, baseVersion.field)
  const expectedValue = baseVersion.value

  if (expectedValue == null) {
    return actualValue == null
  }

  const actualMillis = toComparableMillis(actualValue)
  const expectedMillis = toComparableMillis(expectedValue)
  if (actualMillis != null && expectedMillis != null) {
    return actualMillis >= expectedMillis
  }

  return areValuesEqual(actualValue, expectedValue)
}

const isCanonicalDocumentState = (
  operation: SyncOutboxOperation,
  exists: boolean,
  data: Record<string, unknown> | null
): boolean => {
  if (operation.type === "delete") {
    return !exists
  }
  if (!exists || !data) return false

  const dataMatches = hasExpectedData(operation)
    ? objectContainsSubset(data, operation.data as Record<string, unknown>)
    : false
  const baseVersionMatches = isBaseVersionSatisfied(data, operation.baseVersion)

  if (hasExpectedData(operation) && operation.baseVersion) {
    return dataMatches || baseVersionMatches
  }
  if (hasExpectedData(operation)) {
    return dataMatches
  }
  if (operation.baseVersion) {
    return baseVersionMatches
  }

  return true
}

const waitForCanonicalDocumentState = async (
  operation: SyncOutboxOperation
): Promise<void> => {
  const targetPath = operation.targetPath.trim()
  if (!targetPath) return

  let targetRef: ReturnType<typeof doc>
  try {
    targetRef = doc(firestore, targetPath)
  } catch (error) {
    console.warn(
      "[syncEngine] Invalid target path while waiting for canonical state:",
      targetPath,
      error
    )
    return
  }

  await new Promise<void>((resolve) => {
    let settled = false
    let unsubscribe: Unsubscribe | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null
    const finish = () => {
      if (settled) return
      settled = true
      if (unsubscribe) {
        unsubscribe()
        unsubscribe = null
      }
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      resolve()
    }

    timeout = setTimeout(() => {
      console.warn(
        `[syncEngine] Canonical wait timed out for ${operation.targetPath}`
      )
      finish()
    }, CANONICAL_WAIT_TIMEOUT_MS)

    unsubscribe = onSnapshot(
      targetRef,
      (snapshot) => {
        const exists = snapshot.exists()
        const data = exists ? (snapshot.data() as DocumentData) : null
        const record = isRecord(data) ? data : null
        if (isCanonicalDocumentState(operation, exists, record)) {
          finish()
        }
      },
      (error) => {
        console.warn(
          "[syncEngine] Canonical wait failed; continuing with ack settlement:",
          error
        )
        finish()
      }
    )
  })
}

const waiters: WaiterMap = new Map()
const outbox = ref<SyncOutboxOperation[]>(readOutbox())
const isRunning = ref(false)
// Per-op in-flight tracking — the replacement for the retired whole-loop
// `isSyncing` barrier. The Set feeds `planDispatch` (capacity + no-resend
// guard); the ref mirrors its size for the reactive `isProcessing` seam.
const inFlightSendIds = new Set<string>()
const inFlightSendCount = ref(0)
const isOnline = ref(typeof navigator === "undefined" ? true : navigator.onLine)
const activeUserId = ref<string | null>(auth.currentUser?.uid ?? null)
const clientId = getOrCreateClientId()
const ackSubscribers = new Set<AckSubscriber>()
const canonicalSubscribers = new Set<CanonicalSubscriber>()
const totalAckLatencyMs = ref(0)
const totalAckCount = ref(0)
const totalRetries = ref(0)
const settledBySource = ref<Record<SyncSettleSource, number>>({
  listener: 0,
  callable: 0,
  inspect: 0,
  deadLetter: 0,
})

const recordSettleSource = (source: SyncSettleSource) => {
  settledBySource.value = {
    ...settledBySource.value,
    [source]: settledBySource.value[source] + 1,
  }
}

let authUnsubscribe: Unsubscribe | null = null
let ackUnsubscribe: Unsubscribe | null = null
let syncTimer: ReturnType<typeof setTimeout> | null = null
// Re-attach backoff for the ack listener: `onSnapshot` tears its listener down
// on error, so we must explicitly re-establish it (see ensureAckListener) or
// acks stop arriving entirely. The attempt counter drives an escalating backoff
// and is reset on the first healthy snapshot.
let ackRetryTimer: ReturnType<typeof setTimeout> | null = null
let ackRetryAttempts = 0
// Downgrade latch for the ack query's `createdAt` horizon: the bounded query
// needs a composite index (clientId ASC, createdAt ASC) on `syncOperations`.
// Against a backend without it, `onSnapshot` errors with failed-precondition
// on every attach — flip to the legacy unbounded query instead of wedging the
// ack listener in a retry loop that can never succeed.
let ackHorizonUnsupported = false
let storageSyncCleanup: (() => void) | null = null
// Per-user leader election (Web Locks). Only the leader tab for the active
// user sends; other tabs enqueue + persist and the leader adopts those ops.
let isLeader = false
let leaderUserId: string | null = null
let releaseLeaderLock: (() => void) | null = null

const pendingCount = computed(() => {
  const userId = activeUserId.value
  if (!userId) return 0
  // Parked ops count as pending: they are unsynced local changes, so hiding
  // them would report "synced" while writes are still owed a verdict.
  return outbox.value.filter(
    (operation) =>
      operation.userId === userId && isUnsettledOperation(operation)
  ).length
})
const averageAckLatencyMs = computed(() => {
  if (totalAckCount.value === 0) return 0
  return Math.round(totalAckLatencyMs.value / totalAckCount.value)
})
const outboxSize = computed(() => outbox.value.length)

const notifyAckSubscribers = (event: SyncAckEvent) => {
  ackSubscribers.forEach((subscriber) => {
    try {
      subscriber(event)
    } catch (error) {
      console.error("[syncEngine] Ack subscriber failed", error)
    }
  })
}

const notifyCanonicalSubscribers = (event: SyncCanonicalEvent) => {
  canonicalSubscribers.forEach((subscriber) => {
    try {
      subscriber(event)
    } catch (error) {
      console.error("[syncEngine] Canonical subscriber failed", error)
    }
  })
}

const recordAckLatency = (operation: SyncOutboxOperation) => {
  const latency = Math.max(0, Date.now() - operation.createdAt)
  totalAckLatencyMs.value += latency
  totalAckCount.value += 1
}

const updateOutbox = (
  updater: (operations: SyncOutboxOperation[]) => SyncOutboxOperation[]
) => {
  const next = updater(outbox.value)
  if (next === outbox.value) return
  outbox.value = next
  pathIndexDirty = true
  persistOutbox(next)
}

const getPendingCountForUser = (userId: string): number => {
  // Fast path: if checking for the active user, reuse the computed
  if (userId === activeUserId.value) return pendingCount.value
  return outbox.value.filter(
    (operation) =>
      operation.userId === userId && isUnsettledOperation(operation)
  ).length
}

const isSameBaseVersion = (
  left: SyncBaseVersion | null | undefined,
  right: SyncBaseVersion | null | undefined
) => {
  if (!left && !right) return true
  if (!left || !right) return false
  return left.field === right.field && left.value === right.value
}

const canCoalesceOperation = (
  existing: SyncOutboxOperation,
  incoming: SyncOutboxOperation
) => {
  if (existing.userId !== incoming.userId) return false
  if (existing.status !== "pending") return false
  if (existing.attempts > 0) return false
  // A resumed parked op is pending with attempts 0 but its remote doc already
  // exists — retries settle via the callable, which reads the REMOTE payload,
  // so data coalesced in locally would never reach the server.
  if (existing.remoteCreated) return false
  if (existing.type !== incoming.type) return false
  if (existing.type === "delete") return false
  if (existing.targetPath !== incoming.targetPath) return false
  if ((existing.merge ?? false) !== (incoming.merge ?? false)) return false
  // Coalescing folds payloads with a shallow spread, but the server applies a
  // merge:true set as a DEEP merge — for a shared top-level key carrying a
  // nested map the spread is not equivalent to the two writes in sequence
  // (coalescing {prefs:{a:1}} then {prefs:{b:2}} would destroy `a`). Decline
  // and enqueue separately: exact server semantics preserved. Shared
  // scalar/array keys still coalesce — spread replacement equals Firestore
  // field replacement (see `hasConflictingNestedMergeKey`).
  if (
    existing.type === "set" &&
    (existing.merge ?? false) &&
    hasConflictingNestedMergeKey(existing.data, incoming.data)
  ) {
    return false
  }
  if (!isSameBaseVersion(existing.baseVersion, incoming.baseVersion))
    return false
  return true
}

/**
 * Index of pending operations by `userId:targetPath` → operation id.
 * Lets `tryCoalesceOperation` locate a coalescing candidate in O(1) instead
 * of scanning the whole outbox. Rebuilt lazily from the outbox and kept in
 * sync via `updateOutbox`.
 */
const pendingPathIndex = new Map<string, string>()
let pathIndexDirty = true

const pathIndexKey = (userId: string, targetPath: string) =>
  `${userId}\u0001${targetPath}`

const rebuildPathIndex = () => {
  pendingPathIndex.clear()
  for (const op of outbox.value) {
    if (op.status !== "pending" || op.attempts > 0 || op.remoteCreated) continue
    pendingPathIndex.set(pathIndexKey(op.userId, op.targetPath), op.id)
  }
  pathIndexDirty = false
}

const ensurePathIndex = () => {
  if (pathIndexDirty) rebuildPathIndex()
}

const tryCoalesceOperation = (
  incoming: SyncOutboxOperation
): { operationId: string; coalesced: boolean } | null => {
  // Coalescing applies only to `set`/`update` (not `delete`); bail early so
  // we don't pay the index lookup for deletes.
  if (incoming.type === "delete") return null

  ensurePathIndex()
  const candidateId = pendingPathIndex.get(
    pathIndexKey(incoming.userId, incoming.targetPath)
  )
  if (!candidateId) return null

  let result: { operationId: string; coalesced: boolean } | null = null
  let changed = false

  updateOutbox((operations) => {
    const index = operations.findIndex((op) => op.id === candidateId)
    if (index === -1) return operations

    const existing = operations[index]
    if (!existing || !canCoalesceOperation(existing, incoming))
      return operations

    const next = [...operations]
    next[index] = {
      ...existing,
      data: { ...(existing.data ?? {}), ...(incoming.data ?? {}) },
      source: incoming.source,
      // Strictly advance `updatedAt`: `outboxSnapshotsEqual` compares
      // id/status/updatedAt/attempts but never `data`, so a same-millisecond
      // coalesce with an unchanged stamp would be invisible to peer tabs —
      // the leader would equality-skip the adoption and send the
      // pre-coalesce payload while this waiter still resolves as acked.
      updatedAt: Math.max(incoming.updatedAt, existing.updatedAt + 1),
    }
    changed = true
    result = { operationId: existing.id, coalesced: true }
    return next
  })

  return changed ? result : null
}

const upsertOperation = (
  operationId: string,
  updater: (operation: SyncOutboxOperation) => SyncOutboxOperation
) => {
  updateOutbox((operations) =>
    operations.map((operation) =>
      operation.id === operationId ? updater(operation) : operation
    )
  )
}

const settleWaiters = (
  operationId: string,
  error?: Error,
  result: SyncMutateResult = { status: "ack" }
) => {
  const targets = waiters.get(operationId)
  if (!targets || targets.length === 0) return
  waiters.delete(operationId)

  targets.forEach((waiter) => {
    if (error) {
      waiter.reject(error)
      return
    }
    waiter.resolve(result)
  })
}

/**
 * Settle local waiters for ops whose verdict arrived by ADOPTION (a peer
 * tab's snapshot merged in) rather than through `applyRemoteSettlement`.
 * Without this, the adopted settled status makes the duplicate-report guard
 * in `applyRemoteSettlement` swallow the verdict when this tab's own ack
 * listener later delivers it — and the caller's `mutate()` hangs forever.
 * Adopted acks carry no `updatedAtMillis`; waiters resolve with the plain
 * ack, which the contract allows (the field is optional).
 */
const settleWaitersFromAdoptedVerdicts = (
  operations: readonly SyncOutboxOperation[]
) => {
  if (waiters.size === 0) return
  for (const operation of operations) {
    if (!waiters.has(operation.id)) continue
    if (operation.status === "acked") {
      settleWaiters(operation.id)
    } else if (operation.status === "rejected") {
      settleWaiters(
        operation.id,
        new Error(operation.errorMessage ?? "Sync operation rejected")
      )
    }
  }
}

const rejectWaitersForUser = (userId: string, message: string) => {
  const operationIds = outbox.value
    .filter((operation) => operation.userId === userId)
    .map((operation) => operation.id)

  operationIds.forEach((operationId) => {
    settleWaiters(operationId, new Error(message))
  })
}

const pruneSettledOperations = () => {
  const now = Date.now()
  // `pruneExpiredOperations` returns the same array reference when nothing
  // expired, so `updateOutbox` short-circuits and avoids the per-ack reactive
  // churn (this runs on every ack snapshot).
  updateOutbox((operations) => pruneExpiredOperations(operations, now))
}

const getRetryDelay = (attempts: number): number =>
  Math.max(
    OUTBOX_RETRY_BASE_DELAY_MS,
    Math.round(
      getBackoffDelay(Math.max(attempts - 1, 0), OUTBOX_RETRY_BASE_DELAY_MS)
    )
  )

const scheduleSync = (delay = SYNC_BATCH_WINDOW_MS) => {
  if (!isRunning.value) return
  if (syncTimer) {
    clearTimeout(syncTimer)
  }
  syncTimer = setTimeout(() => {
    syncTimer = null
    processSyncLoop()
  }, delay)
}

const toCarriedOperationPayload = (
  operation: SyncOutboxOperation
): CarriedSyncOperationPayload => ({
  id: operation.id,
  userId: operation.userId,
  clientId: operation.clientId,
  source: operation.source,
  targetPath: operation.targetPath,
  type: operation.type,
  data: operation.data ?? null,
  merge: operation.merge ?? false,
  baseVersion: operation.baseVersion ?? null,
  // Only ops whose remote doc does not exist yet carry, and those are always
  // remotely "pending" (the rules constrain a create to that status too).
  status: "pending",
  attempts: operation.attempts,
  createdAtClient: operation.createdAt,
  updatedAtClient: operation.updatedAt,
  sentAtClient: operation.sentAt ?? null,
})

const toRemoteDocument = (
  operation: SyncOutboxOperation
): RemoteSyncOperationDocument => {
  const isRejected = operation.status === "rejected"

  return {
    ...toCarriedOperationPayload(operation),
    // Remote docs only know pending|ack|reject (rules constrain the enum);
    // the client-local "parked" state maps to "pending".
    status:
      operation.status === "acked" ? "ack" : isRejected ? "reject" : "pending",
    createdAt: serverTimestamp(),
    // Only include ack details when there's meaningful data (client rejection).
    // The server writes its own ack field on settlement.
    ack: isRejected
      ? {
          code: "client_error",
          message: operation.errorMessage ?? null,
          atMs: operation.settledAt ?? null,
        }
      : null,
  }
}

/**
 * On ack, we settle waiters IMMEDIATELY — the server has confirmed the write,
 * so the caller's promise is done. The canonical onSnapshot wait runs in the
 * background purely for telemetry (canonical subscribers) and never blocks
 * the mutate() promise.
 *
 * Previous behavior waited up to 6s for the local cache to reflect the server
 * state before resolving — this compounded with the release-pending delay to
 * make UI feedback feel sluggish. Now `mutate()` returns as soon as the
 * server acks, and the optimistic-update layer handles UI consistency.
 */
const settleAckAfterCanonical = (
  operationId: string,
  eventBase: {
    userId: string
    targetPath: string
    at: number
  },
  outboxOperation?: SyncOutboxOperation,
  result?: SyncMutateResult
) => {
  settleWaiters(operationId, undefined, result)

  // Canonical confirmation is purely observational — it exists only to notify
  // canonical subscribers. When there are none, skip the per-ack onSnapshot +
  // document read entirely; otherwise we'd open and tear down a Firestore
  // listener for every acked operation just to emit an event nobody consumes.
  if (canonicalSubscribers.size === 0) return

  const fireCanonical = (origin: "local") => {
    notifyCanonicalSubscribers({
      userId: eventBase.userId,
      targetPath: eventBase.targetPath,
      origin,
      operationId,
      at: Date.now(),
    })
  }

  if (!outboxOperation) {
    fireCanonical("local")
    return
  }

  // Background canonical confirmation — fire the subscriber event once the
  // local cache reflects the server state. Errors are non-fatal; the event
  // still fires on timeout so any downstream listeners are not starved.
  void waitForCanonicalDocumentState(outboxOperation)
    .catch((error) => {
      console.warn("[syncEngine] Canonical wait failed (non-blocking):", error)
    })
    .finally(() => {
      fireCanonical("local")
    })
}

const applyRemoteSettlement = (
  operationId: string,
  data?: Partial<RemoteSyncOperationDocument>,
  source: SyncSettleSource = "listener"
): boolean => {
  const status = data?.status
  if (status !== "ack" && status !== "reject") return false

  const outboxOperation = outbox.value.find((op) => op.id === operationId)
  if (
    outboxOperation &&
    (outboxOperation.status === "acked" ||
      outboxOperation.status === "rejected")
  ) {
    // Duplicate report (the callable response and the ack snapshot both
    // describe the same settlement) — first one counted, the rest no-op.
    return true
  }

  // Count only settlements that transition a LIVE outbox entry. The ack
  // listener replays every retained remote doc (2h server TTL, and the
  // native TTL deletion can lag) on each (re)attach, while settled outbox
  // entries prune after 1h — counting those replays would inflate `listener`
  // on healthy deploys and invert the callable-vs-listener diagnostic this
  // metric exists for.
  if (outboxOperation) {
    recordSettleSource(source)
  }

  const message = data?.ack?.message ?? undefined
  const settledAt = Date.now()
  const eventBase = {
    operationId,
    userId: outboxOperation?.userId ?? data?.userId ?? "",
    targetPath: outboxOperation?.targetPath ?? data?.targetPath ?? "",
    source: outboxOperation?.source ?? data?.source ?? "sync",
    at: settledAt,
  }

  if (status === "ack") {
    if (outboxOperation) {
      // Settled entries retain only ids + status (dedup/metrics) — the
      // payload is stripped the moment the verdict lands so an hour of
      // retained ~1MB snapshot saves can't blow the localStorage quota
      // (see `stripSettledOperationPayload`).
      upsertOperation(operationId, (operation) =>
        stripSettledOperationPayload({
          ...operation,
          status: "acked",
          updatedAt: settledAt,
          settledAt,
          errorMessage: undefined,
        })
      )
      recordAckLatency(outboxOperation)
    }
    notifyAckSubscribers({
      ...eventBase,
      status: "ack",
      message: null,
    })
    // Resolve the waiter WITH the ack details: the verdict's stamped target
    // `updatedAt` rides along so `mutate()` callers can refresh an OCC base
    // version without waiting for the target snapshot.
    const ackUpdatedAtMillis = data?.ack?.updatedAtMillis
    settleAckAfterCanonical(
      operationId,
      eventBase,
      outboxOperation,
      typeof ackUpdatedAtMillis === "number"
        ? { status: "ack", updatedAtMillis: ackUpdatedAtMillis }
        : { status: "ack" }
    )
    return true
  }

  // Carry the verdict code on the rejection so callers can react to specific
  // rejections structurally (e.g. authStore drops its cached OCC token on a
  // `failed-precondition` base-version conflict) instead of matching text.
  const error = Object.assign(new Error(message ?? "Sync operation rejected"), {
    code: typeof data?.ack?.code === "string" ? data?.ack?.code : undefined,
  })
  if (outboxOperation) {
    upsertOperation(operationId, (operation) =>
      stripSettledOperationPayload({
        ...operation,
        status: "rejected",
        updatedAt: settledAt,
        settledAt,
        errorMessage: error.message,
      })
    )
  }
  notifyAckSubscribers({
    ...eventBase,
    status: "reject",
    message: error.message,
  })
  notifyCanonicalSubscribers({
    userId: eventBase.userId,
    targetPath: eventBase.targetPath,
    origin: "local",
    operationId,
    at: settledAt,
  })
  settleWaiters(operationId, error)
  return true
}

const clearAckRetry = () => {
  if (ackRetryTimer) {
    clearTimeout(ackRetryTimer)
    ackRetryTimer = null
  }
}

const ensureAckListener = (userId: string) => {
  clearAckRetry()
  if (ackUnsubscribe) {
    ackUnsubscribe()
    ackUnsubscribe = null
  }

  // Scope listener to this client's operations to avoid processing
  // stale documents from other tabs/devices as the collection grows.
  // Additionally bounded below by `createdAt`: a cold boot with a stale
  // resume token would otherwise re-bill a read per RETAINED op doc (the
  // server keeps settled docs ~2h — `SYNC_TTL_MS` in syncSettlement.ts,
  // enforced by the native TTL policy on `expireAt`, so actual deletion can
  // lag the horizon) just to replay verdicts for ops the outbox no longer
  // tracks. The horizon is `min(oldest unsettled op createdAt, now - client
  // retention)` — see `computeAckHorizonMillis` — recomputed with a fresh
  // `now` on every (re)attach, so it can move forward between attaches;
  // that is fine, verdicts for pruned-old ops are unneeded. Remote
  // `createdAt` is a server `Timestamp`, so the client-millis horizon is
  // compared as one. The bounded shape (equality + range) needs the
  // collection-scope composite index (clientId ASC, createdAt ASC) in
  // firestore.indexes.json — kept worth its cost even at 2h server
  // retention because the listener replays ALL matching retained docs on
  // every stale-resume-token re-attach, not just cold boots; if the index
  // is missing, `ackHorizonUnsupported` latches the unbounded fallback.
  const operationsCollection = collection(
    firestore,
    "users",
    userId,
    "syncOperations"
  )
  const ackQuery = ackHorizonUnsupported
    ? query(operationsCollection, where("clientId", "==", clientId))
    : query(
        operationsCollection,
        where("clientId", "==", clientId),
        where(
          "createdAt",
          ">=",
          Timestamp.fromMillis(
            computeAckHorizonMillis(outbox.value, userId, Date.now())
          )
        )
      )

  ackUnsubscribe = onSnapshot(
    ackQuery,
    (snapshot) => {
      // A healthy snapshot means the listener is alive — reset the re-attach
      // backoff so a later transient error starts from the base delay.
      ackRetryAttempts = 0
      snapshot.docChanges().forEach((change) => {
        applyRemoteSettlement(
          change.doc.id,
          change.doc.data() as Partial<RemoteSyncOperationDocument>
        )
      })

      pruneSettledOperations()
      scheduleSync()
    },
    (error) => {
      // Benign during sign-out / account switch: the listener emits one
      // final permission-denied snapshot before handleUserChange clears
      // it. Skip the log AND the retry — both are noise once the
      // listener's user is gone.
      if (
        auth.currentUser?.uid !== userId &&
        hasFirebaseErrorCode(error, FirestoreErrorCodes.PERMISSION_DENIED)
      ) {
        return
      }
      // A failed-precondition on the bounded query means the composite index
      // (clientId ASC, createdAt ASC) is missing — retrying the same query
      // can never succeed, so latch the downgrade and let the re-attach below
      // fall back to the legacy unbounded query. Acks matter more than the
      // read savings.
      if (
        !ackHorizonUnsupported &&
        hasFirebaseErrorCode(error, FirestoreErrorCodes.FAILED_PRECONDITION)
      ) {
        ackHorizonUnsupported = true
      }
      console.error("[syncEngine] Failed to listen for operation acks:", error)
      // `onSnapshot` tears the listener down on error, so without an explicit
      // re-attach acks would never arrive again — the send loop keeps running
      // but nothing settles, so every op rides the retry ladder into a
      // parked state — until the next auth change. Re-establish the listener
      // after an escalating backoff, but only while we're still running for
      // this same user, so a transient read error self-heals instead of
      // silently wedging sync.
      clearAckRetry()
      const delay = getBackoffDelay(
        ackRetryAttempts++,
        ACK_LISTENER_RETRY_DELAY_MS
      )
      ackRetryTimer = setTimeout(() => {
        ackRetryTimer = null
        if (!isRunning.value || activeUserId.value !== userId) return
        ensureAckListener(userId)
      }, delay)
      scheduleSync(ACK_LISTENER_RETRY_DELAY_MS)
    }
  )
}

interface ApplySyncOperationRequest {
  operationId: string
  /**
   * Payload carry (create-if-absent): sent on first sends only — see
   * `CarriedSyncOperationPayload`. Old servers strip the unknown key and
   * answer not-found, which the engine downgrades to the setDoc path.
   */
  operation?: CarriedSyncOperationPayload
}

/** Mirrors the server's `SyncSettlementVerdict` (functions/src/syncSettlement.ts). */
interface ApplySyncOperationResponse {
  status: "ack" | "reject"
  code: string | null
  message: string | null
  /** Absent on verdicts from server deploys that predate the ack-updatedAt contract. */
  updatedAtMillis?: number | null
}

let applySyncOperationCallable: HttpsCallable<
  ApplySyncOperationRequest,
  ApplySyncOperationResponse
> | null = null

const getApplySyncOperationCallable = () => {
  applySyncOperationCallable ??= httpsCallable<
    ApplySyncOperationRequest,
    ApplySyncOperationResponse
  >(functions, "applySyncOperation")
  return applySyncOperationCallable
}

/**
 * Feed a callable verdict through `applyRemoteSettlement` — the same
 * idempotent entry point the ack listener uses, so whichever path reports
 * first wins and the other no-ops. Returns false when the response carried
 * no recognizable verdict.
 */
const applyCallableVerdict = (
  operationId: string,
  verdict: ApplySyncOperationResponse | undefined
): boolean => {
  if (verdict?.status !== "ack" && verdict?.status !== "reject") return false
  applyRemoteSettlement(
    operationId,
    {
      status: verdict.status,
      ack: {
        code: verdict.code ?? null,
        message: verdict.message ?? null,
        atMs: Date.now(),
        updatedAtMillis:
          typeof verdict.updatedAtMillis === "number"
            ? verdict.updatedAtMillis
            : null,
      },
    },
    "callable"
  )
  // The settled op may have been blocking same-path successors — re-run the
  // loop now instead of waiting for the ack snapshot (which mirrors this
  // via its own scheduleSync) or the head's backoff wake.
  scheduleSync()
  return true
}

/**
 * Warm-path FIRST send: invoke `applySyncOperation` carrying the op payload,
 * so the server creates the op doc and settles it in a single transaction —
 * no op-doc `setDoc` round trip first. Resolves `true` when the engine must
 * FALL BACK to the setDoc path: the deployed server predates payload carry
 * (the old-server not-found downgrade — not a failure), the invocation
 * failed in transport, or the response carried no verdict. The fallback
 * keeps the pre-carry pipeline intact: setDoc stamps `remoteCreated`, the
 * create trigger backstop settles, and retries re-invoke the callable.
 */
const requestCarriedSettlement = async (
  operation: SyncOutboxOperation
): Promise<boolean> => {
  try {
    const result = await getApplySyncOperationCallable()({
      operationId: operation.id,
      operation: toCarriedOperationPayload(operation),
    })
    return !applyCallableVerdict(operation.id, result.data)
  } catch (error) {
    const current = outbox.value.find(
      (candidate) => candidate.id === operation.id
    )
    if (current && isOldServerPayloadCarryNotFound(error, current)) {
      // Quiet downgrade: the setDoc path is the contract the old server
      // understands. (Never the P0 terminal disposition — that requires
      // `remoteCreated`, and carried sends only happen without it.)
      return true
    }
    console.warn(
      "[syncEngine] Carried settlement request failed (non-fatal):",
      error
    )
    return true
  }
}

/**
 * Ask the server to settle `operation` NOW via the `applySyncOperation`
 * callable instead of waiting on the create-trigger (Eventarc) → ack-listener
 * chain. Invoked WITHOUT the payload: this path is for ops whose remote doc
 * already exists (`remoteCreated`), where re-carrying a payload could
 * re-create a TTL-swept doc from stale data. The verdict flows through
 * `applyRemoteSettlement` via `applyCallableVerdict`.
 *
 * Transport errors are SOFT by design: the create trigger remains the
 * backstop, the ack listener may still deliver, and the backoff loop
 * re-invokes this callable. Rejecting on a transport failure would turn an
 * offline blip, a cold function, or a not-yet-deployed callable into a
 * rolled-back write. Only an explicit `"reject"` VERDICT rejects an op.
 */
const requestDirectSettlement = async (
  operation: SyncOutboxOperation
): Promise<void> => {
  try {
    const result = await getApplySyncOperationCallable()({
      operationId: operation.id,
    })
    applyCallableVerdict(operation.id, result.data)
  } catch (error) {
    const current = outbox.value.find(
      (candidate) => candidate.id === operation.id
    )
    // A callable "not-found" for an op whose create WAS acked is definitive:
    // the op doc was settled + TTL-swept (this client missed the verdict) or
    // orphan-swept — no verdict can ever arrive, and parking would pin the
    // sync indicator and (via per-path FIFO) block every later write to the
    // target forever. Settle client-side as rejected through the same path a
    // server reject verdict takes (waiter rejects → runWrite rolls back).
    // This converges even if the op HAD actually been acked before the sweep:
    // reads are live listeners, so the target doc's true state re-syncs
    // regardless of the local rollback.
    if (current && isDefinitiveNotFound(error, current)) {
      applyRemoteSettlement(
        current.id,
        {
          status: "reject",
          ack: {
            code: "not-found",
            message: "Sync operation expired before its verdict was observed",
            atMs: Date.now(),
          },
        },
        "callable"
      )
      // The settled op may have been blocking same-path successors.
      scheduleSync()
      return
    }
    // The invocation itself failed — the verdict may still arrive via the
    // create-trigger → ack-listener backstop, but waiting out the full ack
    // timeout for a KNOWN-dead attempt adds seconds of pure lag. Pull the
    // op's eligibility forward instead (doubling per consecutive detected
    // failure, capped at the ladder). Skip ops out of attempt budget: their
    // remaining ladder window is the grace period for a late listener verdict
    // before parking.
    if (
      current &&
      current.status === "sent" &&
      current.remoteCreated &&
      !shouldPark(current)
    ) {
      const now = Date.now()
      const delay = computeFastRetryDelay(
        current.fastRetries ?? 0,
        getRetryDelay(current.attempts)
      )
      upsertOperation(current.id, (op) => ({
        ...op,
        fastRetries: (op.fastRetries ?? 0) + 1,
        nextEligibleAt: now + delay,
        updatedAt: now,
      }))
      // Plain kick (not `scheduleSync(delay)`): the loop derives the fast
      // wake from `nextEligibleAt` itself, and a delayed reschedule here
      // would push back an earlier wake owed to some other op.
      scheduleSync()
    }
    console.warn(
      "[syncEngine] Direct settlement request failed (non-fatal):",
      error
    )
  }
}

const sendOperation = async (operation: SyncOutboxOperation): Promise<void> => {
  const now = Date.now()
  // Ladder-due sends burn an attempt; a fast retry (pulled forward by
  // `nextEligibleAt` after a detected callable failure) does not, so detected
  // failures can't exhaust the ~45s budget early. `fastRetries` resets on
  // every full attempt so the next detected failure starts at the base delay.
  const isFullAttempt = isFullAttemptSend(operation, now, getRetryDelay)
  const isRetryAttempt = operation.attempts > 0
  if (isRetryAttempt) {
    totalRetries.value += 1
  }
  upsertOperation(operation.id, (current) => ({
    ...current,
    status: "sent",
    attempts: isFullAttempt ? current.attempts + 1 : current.attempts,
    fastRetries: isFullAttempt ? undefined : current.fastRetries,
    nextEligibleAt: undefined,
    // `sentAt` anchors the ladder: stamped only on full attempts, because
    // restamping it on fast sends restarts the backoff clock — eligibility
    // AND fast-vs-full classification measure from it, so against a
    // fast-failing callable the time-to-park would stretch from the
    // documented ~45s to a jitter-dependent ~90-150s.
    sentAt: isFullAttempt ? now : current.sentAt,
    updatedAt: now,
    errorMessage: undefined,
  }))

  const next = outbox.value.find((candidate) => candidate.id === operation.id)
  if (!next) return

  if (!next.remoteCreated) {
    // Payload carry: the callable goes out IMMEDIATELY with the op payload —
    // no op-doc setDoc round trip first — so a warm-path write settles in one
    // round trip. Only on fallback does the pre-carry pipeline run below.
    const needsFallback = await requestCarriedSettlement(next)
    if (!needsFallback) return

    const current = outbox.value.find(
      (candidate) => candidate.id === operation.id
    )
    // A verdict (or teardown) may have raced in while the carried invocation
    // failed — never (re)create a doc for a settled op.
    if (!current || !isUnsettledOperation(current)) return
    if (!(await createRemoteOperationDocument(current))) return

    const created = outbox.value.find(
      (candidate) => candidate.id === operation.id
    )
    if (!created) return
    // Fire-and-forget, matching the pre-carry pipeline: the waiter settles
    // via `applyRemoteSettlement` whichever path (callable response, ack
    // listener) reports first.
    void requestDirectSettlement(created)
    return
  }

  await requestDirectSettlement(next)
}

/**
 * Create the remote op doc via `setDoc` — the pre-carry submission path, now
 * the FALLBACK when a carried settlement could not complete (old server,
 * transport failure): the doc create fires the trigger backstop, which
 * settles it server-side. Returns false when the op was settled client-side
 * instead (a deterministic verdict-equivalent submission failure); ambiguous
 * submission errors — and verdict-equivalent ones whose post-failure inspect
 * read itself failed — are rethrown so the caller's retry ladder keeps
 * riding.
 */
const createRemoteOperationDocument = async (
  operation: SyncOutboxOperation
): Promise<boolean> => {
  const operationRef = doc(
    firestore,
    "users",
    operation.userId,
    "syncOperations",
    operation.id
  )

  try {
    await setDoc(operationRef, toRemoteDocument(operation), { merge: true })
  } catch (error) {
    const errorCode =
      typeof error === "object" &&
      error &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : null

    // Only deterministic verdict-equivalent codes may settle a client-side
    // reject without a server verdict: rules evaluation, argument
    // validation, and precondition checks are pure functions of the op's
    // payload and target state, so a retry can only fail identically —
    // rejecting now matches the verdict the server would hand down. Every
    // other code (unauthenticated, unknown, …) is ambiguous and rides the
    // retry ladder into a park like any other verdict-less failure, instead
    // of rolling back a write the server might still accept.
    if (isVerdictEquivalentSubmissionCode(errorCode)) {
      let remoteOperation
      try {
        remoteOperation = await getDoc(operationRef)
      } catch (readError) {
        // Double fault: the carried callable's transaction may have COMMITTED
        // server-side with its response lost — this setDoc denial then only
        // proves the doc is no longer pending (`isValidSyncOperationRetry`
        // requires pending), and a failed inspect proves nothing at all.
        // Settling a client reject here would roll back a write the server
        // applied, and the later real ack would be discarded by the
        // settle-once guard. Rethrow so the retry ladder rides instead: the
        // next pass re-invokes the callable, which returns the stored
        // verdict for a settled doc.
        console.warn(
          "[syncEngine] Failed to inspect remote operation state:",
          readError
        )
        throw error
      }
      if (
        remoteOperation.exists() &&
        applyRemoteSettlement(
          operation.id,
          remoteOperation.data() as Partial<RemoteSyncOperationDocument>,
          "inspect"
        )
      ) {
        return false
      }

      // Inspection COMPLETED and found the doc confirmed absent or genuinely
      // still pending — the denial really is the deterministic verdict, so
      // settle it client-side.
      const rejectError = new Error(getFirestoreErrorMessage(error))
      const settledAt = Date.now()
      upsertOperation(operation.id, (current) =>
        stripSettledOperationPayload({
          ...current,
          status: "rejected",
          updatedAt: settledAt,
          settledAt,
          errorMessage: rejectError.message,
        })
      )
      settleWaiters(operation.id, rejectError)
      return false
    }
    throw error
  }

  // Created (or merged onto a doc surviving from a prior session). From
  // here on, retries go through the callable ONLY: rewriting the doc is an
  // update, which `onDocumentCreated` never re-fires for — so a rewrite
  // can't recover a lost create event, it just burns a Firestore write.
  upsertOperation(operation.id, (current) => ({
    ...current,
    remoteCreated: true,
    updatedAt: Date.now(),
  }))
  return true
}

let parkedResumeTimer: ReturnType<typeof setInterval> | null = null

const hasParkedOperations = (): boolean =>
  outbox.value.some((operation) => operation.status === "parked")

const clearParkedResumeTimer = (): void => {
  if (parkedResumeTimer) {
    clearInterval(parkedResumeTimer)
    parkedResumeTimer = null
  }
}

/**
 * Resume trigger: give the active user's parked ops a fresh attempt budget
 * and kick the loop. Fired on the window 'online' event, engine (re)start,
 * visibility returning, and the slow parked-resume interval — the moments
 * connectivity plausibly changed.
 */
const resumeParkedForActiveUser = (): void => {
  if (!isRunning.value) return
  const userId = activeUserId.value
  if (!userId) return
  const before = outbox.value
  updateOutbox((operations) =>
    resumeParkedOperations(operations, userId, Date.now())
  )
  if (outbox.value !== before) scheduleSync()
}

const ensureParkedResumeTimer = (): void => {
  if (parkedResumeTimer || !hasParkedOperations()) return
  parkedResumeTimer = setInterval(() => {
    if (!hasParkedOperations()) {
      clearParkedResumeTimer()
      return
    }
    resumeParkedForActiveUser()
  }, PARKED_RESUME_INTERVAL_MS)
}

/**
 * Out of attempts with no server verdict — park instead of dead-lettering.
 * The waiter stays pending and the optimistic state stays applied: under
 * lie-fi the op doc's `setDoc` sits in the local cache's offline queue and
 * WILL commit + settle server-side once real connectivity returns, so a
 * terminal rollback here would report a failure for a write the server later
 * applies. A late verdict still settles the op normally through
 * `applyRemoteSettlement` (parked is not a settled status, so the idempotence
 * guard lets it through); otherwise a resume trigger restarts the ladder.
 * Dead-letter quarantine now applies only to corrupt/schema-invalid entries.
 */
const parkOperation = (operation: SyncOutboxOperation): void => {
  const now = Date.now()
  upsertOperation(operation.id, (current) => ({
    ...current,
    status: "parked",
    parkedAt: now,
    updatedAt: now,
  }))
  ensureParkedResumeTimer()
}

/**
 * Start one send and track it in the in-flight set. `sendOperation` marks
 * the op "sent" synchronously (before its first await), so the claim happens
 * inside the dispatching loop pass — an overlapping pass can never select
 * the same op again, and `planDispatch`'s in-flight guard backstops even a
 * mid-send eligibility pull (peer-tab merge, due `nextEligibleAt`).
 */
const dispatchSend = (operation: SyncOutboxOperation): void => {
  inFlightSendIds.add(operation.id)
  inFlightSendCount.value = inFlightSendIds.size
  void sendOperation(operation)
    .catch((error) => {
      console.error("[syncEngine] Failed to submit operation:", error)
    })
    .finally(() => {
      inFlightSendIds.delete(operation.id)
      inFlightSendCount.value = inFlightSendIds.size
      // A completed send frees capacity — re-select immediately so queued
      // work (ready ops beyond the cap, freed same-path successors) goes out
      // without waiting for a ladder wake.
      scheduleSync()
    })
}

const processSyncLoop = () => {
  if (!isRunning.value) return
  const userId = activeUserId.value
  if (!userId || !isOnline.value) return
  // Only the elected leader tab for this user sends, so multiple tabs never
  // double-submit the same operation. Non-leaders still enqueue + persist; the
  // leader adopts those ops via the storage listener.
  if (!isLeader) return

  const { dispatch, park, nextRetryInMs } = planDispatch(
    outbox.value,
    userId,
    Date.now(),
    getRetryDelay,
    inFlightSendIds,
    MAX_PARALLEL_SENDS
  )

  // A write that burned through its attempt budget without a server verdict
  // parks: excluded from sending until a resume trigger, waiter left pending,
  // optimistic state kept. Same-path successors stay queued behind it so
  // per-path FIFO holds across the park/resume cycle.
  for (const operation of park) {
    parkOperation(operation)
  }
  for (const operation of dispatch) {
    dispatchSend(operation)
  }

  // Parking promoted same-path successors to heads — re-select for them right
  // away. Sooner-wins ordering: `scheduleSync` keeps a single timer, and the
  // immediate pass re-derives any backoff wake `nextRetryInMs` called for.
  if (park.length > 0) {
    scheduleSync()
    return
  }
  // Something is mid-backoff: wake when it is due rather than stalling. Sends
  // dispatched above reschedule themselves on completion.
  if (nextRetryInMs !== null) scheduleSync(nextRetryInMs)
}

const handleUserChange = (nextUserId: string | null) => {
  const previousUserId = activeUserId.value
  activeUserId.value = nextUserId

  if (previousUserId && previousUserId !== nextUserId) {
    rejectWaitersForUser(previousUserId, "Sync stopped because account changed")
    clearOutboxForUser(previousUserId)
  }

  if (ackUnsubscribe) {
    ackUnsubscribe()
    ackUnsubscribe = null
  }
  clearAckRetry()

  if (!isRunning.value || !nextUserId) {
    releaseLeadership()
    return
  }
  ensureAckListener(nextUserId)
  ensureLeadership(nextUserId)
  scheduleSync()
}

const ensureAuthListener = () => {
  if (authUnsubscribe) return

  authUnsubscribe = onIdTokenChanged(auth, (user) => {
    handleUserChange(user?.uid ?? null)
  })
}

let onlineCleanup: (() => void) | null = null
let unloadCleanup: (() => void) | null = null

const ensureOnlineListeners = () => {
  if (!hasWindow()) return
  // Clean up previous listeners to avoid duplicates
  if (onlineCleanup) {
    onlineCleanup()
    onlineCleanup = null
  }

  const markOnline = () => {
    isOnline.value = true
    resumeParkedForActiveUser()
    scheduleSync()
  }
  const markOffline = () => {
    isOnline.value = false
  }

  window.addEventListener("online", markOnline)
  window.addEventListener("offline", markOffline)

  onlineCleanup = () => {
    window.removeEventListener("online", markOnline)
    window.removeEventListener("offline", markOffline)
  }
}

/**
 * Flush any debounced outbox write before the page unloads so we don't lose
 * pending operations. `pagehide` covers bfcache, mobile Safari, and normal
 * navigation; `beforeunload` catches desktop refresh.
 */
const ensureUnloadFlush = () => {
  if (!hasWindow() || unloadCleanup) return

  const flush = () => {
    flushOutboxPersist()
  }

  window.addEventListener("pagehide", flush)
  window.addEventListener("beforeunload", flush)

  unloadCleanup = () => {
    window.removeEventListener("pagehide", flush)
    window.removeEventListener("beforeunload", flush)
  }
}

let visibilityCleanup: (() => void) | null = null

/**
 * Returning to a backgrounded tab is a strong "connectivity may have changed"
 * signal that fires even when lie-fi never emits an 'online' edge — resume
 * any parked ops so the user's oldest unsynced writes retry promptly.
 */
const ensureVisibilityListener = () => {
  if (!hasWindow() || visibilityCleanup) return

  const onVisibilityChange = () => {
    if (document.visibilityState !== "visible") return
    resumeParkedForActiveUser()
  }

  document.addEventListener("visibilitychange", onVisibilityChange)
  visibilityCleanup = () => {
    document.removeEventListener("visibilitychange", onVisibilityChange)
  }
}

const releaseLeadership = (): void => {
  const release = releaseLeaderLock
  releaseLeaderLock = null
  isLeader = false
  leaderUserId = null
  // Resolving the held promise frees the Web Lock so a sibling tab can lead.
  if (release) release()
}

const ensureLeadership = (userId: string): void => {
  if (leaderUserId === userId) return
  // Switching the user we lead for: drop the previous user's lock first.
  releaseLeadership()
  leaderUserId = userId

  const locks =
    hasWindow() && typeof navigator !== "undefined"
      ? navigator.locks
      : undefined
  if (!locks?.request) {
    // No Web Locks support (e.g. older Safari) → act as the sole writer. This
    // matches prior single-writer behavior; any cross-tab duplicate sends are
    // safe because the server already tolerates op-id-idempotent retries.
    isLeader = true
    scheduleSync()
    return
  }

  void locks
    .request(SYNC_LEADER_LOCK_PREFIX + userId, () => {
      // Lock acquired. Bail if the active user changed while we were queued.
      if (leaderUserId !== userId) return Promise.resolve()
      isLeader = true
      scheduleSync()
      // Hold the lock until we explicitly release (sign-out / user switch) or
      // the tab is destroyed — at which point the browser frees it and a queued
      // sibling tab becomes leader automatically.
      return new Promise<void>((resolve) => {
        releaseLeaderLock = resolve
      })
    })
    .catch((error: unknown) => {
      if (leaderUserId !== userId) return
      console.warn("[syncEngine] Leader lock acquisition failed:", error)
      // Degrade to sole-writer so sync still runs in this tab.
      isLeader = true
      scheduleSync()
    })
}

const ensureStorageSyncListener = (): void => {
  if (!hasWindow() || storageSyncCleanup) return

  const onStorage = (event: StorageEvent) => {
    if (event.key !== OUTBOX_STORAGE_KEY) return
    // A peer tab rewrote the shared outbox. Merge its view into ours so we
    // converge — adopting ops it enqueued and the send/ack progress it
    // recorded — without dropping our own in-flight operations. (The persist
    // fast path needs no flag flipped here: it self-verifies against the
    // stored string — see `lastWrittenOutboxRaw` — so a missed or late
    // storage event can never cause a peer write to be overwritten.)
    const merged = mergeOutboxSnapshots(
      outbox.value,
      parseOutbox(event.newValue).valid,
      Date.now()
    )
    if (outboxSnapshotsEqual(merged, outbox.value)) return
    // Assign directly (not via `updateOutbox`) so we don't re-persist what the
    // peer already wrote; the equality guard above stops storage-event
    // ping-pong between tabs.
    outbox.value = merged
    pathIndexDirty = true
    // A settled status adopted here must settle OUR waiters: once the entry
    // is settled locally, `applyRemoteSettlement`'s duplicate-report guard
    // swallows the ack listener's later delivery, so this is the only settle
    // path left for waiters registered in this tab.
    settleWaitersFromAdoptedVerdicts(merged)
    // A snapshot written by a build that still persisted "parked" may carry
    // it — keep the slow resume net armed.
    ensureParkedResumeTimer()
    scheduleSync()
  }

  window.addEventListener("storage", onStorage)
  storageSyncCleanup = () => {
    window.removeEventListener("storage", onStorage)
  }
}

let initialized = false

const ensureInitialized = () => {
  if (initialized) return
  initialized = true
  ensureAuthListener()
  ensureOnlineListeners()
  ensureUnloadFlush()
  ensureStorageSyncListener()
  ensureVisibilityListener()
  pruneSettledOperations()
  // A previous session may have persisted parked ops — keep the slow resume
  // net running for them even before an explicit resume trigger fires.
  ensureParkedResumeTimer()
}

const registerWaiter = (operationId: string): Promise<SyncMutateResult> =>
  new Promise<SyncMutateResult>((resolve, reject) => {
    const list = waiters.get(operationId) ?? []
    list.push({ resolve, reject })
    waiters.set(operationId, list)
  })

const clearOutboxForUser = (userId: string) => {
  const hasAny = outbox.value.some((operation) => operation.userId === userId)
  if (!hasAny) return

  updateOutbox((operations) =>
    operations.filter((operation) => operation.userId !== userId)
  )
}

const enqueueOperation = (operation: SyncOutboxOperation) => {
  updateOutbox((operations) => [...operations, operation])
}

export interface EnqueueOptions {
  schedule?: "immediate" | "microtask"
}

export interface EnqueuedSyncOperation {
  operationId: string
  /** Resolves with the server ack details — see {@link SyncMutateResult}. */
  settled: Promise<SyncMutateResult>
  coalesced: boolean
}

export function enqueue(
  payload: SyncMutatePayload,
  options: EnqueueOptions = {}
): EnqueuedSyncOperation {
  ensureInitialized()
  if (!isRunning.value) {
    initSync()
  }

  const userId = activeUserId.value ?? auth.currentUser?.uid ?? null
  if (!userId) {
    throw new Error(
      "Cannot enqueue sync operation without an authenticated user"
    )
  }
  if (activeUserId.value !== userId) {
    handleUserChange(userId)
  }

  const now = Date.now()
  const operation: SyncOutboxOperation = {
    ...payload,
    id: createId(),
    userId,
    clientId,
    status: "pending",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  }

  const coalesced = tryCoalesceOperation(operation)
  if (coalesced) {
    const waiter = registerWaiter(coalesced.operationId)
    const schedule = () => scheduleSync()
    if (options.schedule === "microtask") {
      queueMicrotask(schedule)
    } else {
      schedule()
    }
    return {
      operationId: coalesced.operationId,
      settled: waiter,
      coalesced: true,
    }
  }

  pruneSettledOperations()
  const pendingForUser = getPendingCountForUser(userId)
  if (pendingForUser >= OUTBOX_MAX_PENDING_PER_USER) {
    throw new Error(
      "Sync queue is full. Please wait for pending changes to finish syncing."
    )
  }

  enqueueOperation(operation)
  const waiter = registerWaiter(operation.id)
  const schedule = () => scheduleSync()
  if (options.schedule === "microtask") {
    queueMicrotask(schedule)
  } else {
    schedule()
  }

  return {
    operationId: operation.id,
    settled: waiter,
    coalesced: false,
  }
}

export function initSync(): void {
  ensureInitialized()
  isRunning.value = true

  const userId = auth.currentUser?.uid ?? null
  handleUserChange(userId)
  // Engine (re)start is a resume trigger: parked ops from a previous session
  // (or a prior stop) get a fresh attempt budget.
  resumeParkedForActiveUser()
  scheduleSync()
}

export function stopSync(): void {
  isRunning.value = false
  if (syncTimer) {
    clearTimeout(syncTimer)
    syncTimer = null
  }
  if (ackUnsubscribe) {
    ackUnsubscribe()
    ackUnsubscribe = null
  }
  clearAckRetry()
  clearParkedResumeTimer()
  if (onlineCleanup) {
    onlineCleanup()
    onlineCleanup = null
  }
  releaseLeadership()
  if (activeUserId.value) {
    rejectWaitersForUser(activeUserId.value, "Sync stopped")
  }
  // Persist any debounced outbox writes immediately so subsequent inits
  // read a consistent snapshot.
  flushOutboxPersist()
}

/**
 * Validate a mutation payload against the path's registered schema, if any.
 *
 * This is the single choke point for write-side validation — every mutation
 * helper (`mutateSetDocument`, `mutateUpdateDocument`, `mutateDeleteDocument`)
 * funnels through `mutate()`, so adding validation here covers all of them with
 * one change.
 *
 * Rules:
 *   - `delete` operations have no data — skip validation entirely.
 *   - `set` with `merge: false` expects a complete document — use
 *     `assertValid` to enforce the write schema.
 *   - `set` with `merge: true` and `update` are partial — use
 *     `validatePartialUpdate` which iterates the patch's keys and validates
 *     each field individually (allowing FieldValue sentinels and dotted
 *     field paths to pass through).
 *
 * Paths without a registry entry pass through unvalidated. Throws
 * `SchemaValidationError` on failure, which propagates to the caller — the
 * sync engine never enqueues invalid data.
 */
const validateMutationPayload = (payload: SyncMutatePayload): void => {
  if (payload.data === undefined) return
  const schemas = lookupSchema(payload.targetPath)
  if (!schemas) return

  const ctx = `${payload.type}:${schemas.name}`
  if (payload.type === "set" && !payload.merge) {
    assertValid(schemas.write, payload.data, ctx)
  } else {
    validatePartialUpdate(schemas.write, payload.data, ctx)
  }
}

/**
 * Enqueue a validated mutation and wait for its server verdict.
 *
 * Settlement contract: the promise resolves on a server ack — WITH the ack
 * details, `{ status: "ack", updatedAtMillis?: number }`, where
 * `updatedAtMillis` (when present) is the target document's post-settlement
 * `updatedAt` for OCC base-version refresh (see {@link SyncMutateResult}) —
 * and rejects only on a server reject verdict, an invalid payload
 * (`SchemaValidationError` thrown synchronously), or engine teardown (stop /
 * account switch). It NEVER rejects on transport failure — offline or
 * against an unreachable backend the operation parks in the persisted outbox
 * with its optimistic state still applied, and the promise stays pending
 * until connectivity resumes and a verdict arrives. Callers must not treat a
 * long-pending `mutate()` as an error.
 */
export async function mutate(
  payload: SyncMutatePayload
): Promise<SyncMutateResult> {
  validateMutationPayload(payload)
  const queued = enqueue(payload, { schedule: "microtask" })
  return await queued.settled
}

export function getPendingOperations(
  userId: string | null = activeUserId.value
): SyncOutboxOperation[] {
  if (!userId) return []

  return outbox.value.filter(
    (operation) =>
      operation.userId === userId && isUnsettledOperation(operation)
  )
}

export function getOutboxOperations(
  userId: string | null = activeUserId.value
): SyncOutboxOperation[] {
  if (!userId) return []
  return outbox.value.filter((operation) => operation.userId === userId)
}

export function useSyncEngineState(): SyncEngineState {
  return {
    activeUserId: computed(() => activeUserId.value),
    isRunning: computed(() => isRunning.value),
    isOnline: computed(() => isOnline.value),
    isProcessing: computed(() => inFlightSendCount.value > 0),
    pendingCount,
  }
}

export function useSyncMetricsState(): SyncMetricsState {
  return {
    outboxSize,
    pendingCount,
    averageAckLatencyMs,
    totalRetries: computed(() => totalRetries.value),
    settledBySource: computed(() => settledBySource.value),
    quarantineCount: computed(() => {
      try {
        const raw = window.localStorage.getItem(OUTBOX_QUARANTINE_STORAGE_KEY)
        return raw ? (JSON.parse(raw) as unknown[]).length : 0
      } catch {
        return 0
      }
    }),
  }
}

/** Raw quarantine-ring records, absent-and-corrupt tolerant. */
const readQuarantineRecords = (): unknown[] => {
  if (!hasWindow()) return []
  try {
    const raw = window.localStorage.getItem(OUTBOX_QUARANTINE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Read the dead-letter quarantine ring — outbox entries dropped on read
 * because they failed schema validation (capped at 500, localStorage-backed).
 * Diagnostics counterpart to `useSyncMetricsState().quarantineCount`: returns
 * the raw entries so a console session (or a future UI) can inspect what was
 * dropped and decide whether to `requeueQuarantinedOutboxEntries()`.
 */
export function listQuarantinedOutboxEntries(): QuarantinedOutboxEntry[] {
  return toQuarantinedOutboxEntries(readQuarantineRecords())
}

/**
 * Re-enqueue quarantined entries that are viable under the CURRENT outbox
 * schema (see `planQuarantineRequeue`: unsettled, active user's, parseable —
 * e.g. rows quarantined by an older build's stricter schema). Each viable
 * entry re-enters the pipeline as a FRESH operation — new id, full payload
 * validation, normal verdict lifecycle — never by resurrecting the
 * quarantined record itself. An entry leaves the ring only AFTER its
 * validate+enqueue succeeded: one that fails the path schema (or a full
 * queue) stays quarantined instead of being dropped on the floor. Settlement
 * is not awaited: a server reject of a re-enqueued write surfaces through
 * the normal ack channels, not from this call.
 */
export function requeueQuarantinedOutboxEntries(): {
  requeued: number
  kept: number
} {
  const records = readQuarantineRecords()
  const userId = activeUserId.value ?? auth.currentUser?.uid ?? null
  if (!userId || records.length === 0) {
    return { requeued: 0, kept: records.length }
  }

  const { requeue, keep } = planQuarantineRequeue(records, userId)
  let requeued = 0
  for (const { operation, record } of requeue) {
    const payload: SyncMutatePayload = {
      source: operation.source,
      targetPath: operation.targetPath,
      type: operation.type,
      data: operation.data,
      merge: operation.merge,
      baseVersion: operation.baseVersion,
    }
    try {
      validateMutationPayload(payload)
      const { settled } = enqueue(payload, { schedule: "microtask" })
      settled.catch((error) => {
        console.warn(
          "[syncEngine] Re-enqueued quarantined operation did not settle as ack:",
          error
        )
      })
      requeued += 1
    } catch (error) {
      // Validation (or enqueue) refused the payload — keep the raw record
      // quarantined so the entry is never silently lost.
      keep.push(record)
      console.warn(
        "[syncEngine] Quarantined entry failed re-enqueue; keeping it quarantined:",
        error
      )
    }
  }

  if (keep.length !== records.length) {
    try {
      window.localStorage.setItem(
        OUTBOX_QUARANTINE_STORAGE_KEY,
        JSON.stringify(keep)
      )
    } catch (error) {
      console.warn(
        "[syncEngine] Failed to rewrite the outbox quarantine ring",
        error
      )
    }
  }

  return { requeued, kept: keep.length }
}

export function subscribeAcks(subscriber: AckSubscriber): Unsubscribe {
  ackSubscribers.add(subscriber)
  return () => {
    ackSubscribers.delete(subscriber)
  }
}

export function subscribeCanonical(
  subscriber: CanonicalSubscriber
): Unsubscribe {
  canonicalSubscribers.add(subscriber)
  return () => {
    canonicalSubscribers.delete(subscriber)
  }
}

export function publishCanonical(event: SyncCanonicalEvent): void {
  notifyCanonicalSubscribers(event)
}

export const syncEngine = {
  initSync,
  stopSync,
  mutate,
  enqueue,
  subscribeAcks,
  subscribeCanonical,
}

export const buildUpdatedAtBaseVersion = (
  updatedAt: unknown
): SyncBaseVersion | null => {
  const millis = toComparableMillis(updatedAt)
  if (millis == null) return null
  return {
    field: "updatedAt",
    value: millis,
  }
}

interface SyncDocumentWriteOptions {
  source: string
  merge?: boolean
  baseVersion?: SyncBaseVersion | null
}

/**
 * NOTE: the document-level helpers below deliberately stay `Promise<void>`:
 * several callers pipe them into `Promise<void>`-typed slots, so widening
 * them is a breaking change. Callers that need the ack details (OCC
 * base-version refresh) should call `mutate()` — which resolves with
 * {@link SyncMutateResult} — directly.
 */
export async function mutateSetDocument(
  ref: DocumentReference,
  data: Record<string, unknown>,
  options: SyncDocumentWriteOptions
): Promise<void> {
  await mutate({
    source: options.source,
    targetPath: ref.path,
    type: "set",
    data,
    merge: options.merge ?? false,
    baseVersion: options.baseVersion ?? null,
  })
}

/**
 * Persist a document with `merge: true` and uniform error handling, returning a
 * boolean instead of throwing. Shared by the settings and layout stores, which
 * previously each defined a byte-identical local `safeSetDoc`. A `null` ref
 * (e.g. before the team/user is resolved) is treated as a no-op failure.
 *
 * @returns `true` on success, `false` if the ref was null or the write failed.
 */
export async function safeSetDocument(
  ref: DocumentReference | null,
  data: Record<string, unknown>,
  source: string
): Promise<boolean> {
  if (!ref) return false
  try {
    await mutateSetDocument(ref, data, { source, merge: true })
    return true
  } catch (error) {
    console.error(
      `[safeSetDocument:${source}] Failed to persist to Firestore:`,
      error
    )
    return false
  }
}

export async function mutateUpdateDocument(
  ref: DocumentReference,
  updates: Record<string, unknown>,
  options: Omit<SyncDocumentWriteOptions, "merge">
): Promise<void> {
  await mutate({
    source: options.source,
    targetPath: ref.path,
    type: "update",
    data: updates,
    baseVersion: options.baseVersion ?? null,
  })
}

export async function mutateDeleteDocument(
  ref: DocumentReference,
  options: Omit<SyncDocumentWriteOptions, "merge">
): Promise<void> {
  await mutate({
    source: options.source,
    targetPath: ref.path,
    type: "delete",
    baseVersion: options.baseVersion ?? null,
  })
}
