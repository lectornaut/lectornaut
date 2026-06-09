import { generateId } from "@/helpers/utilities"
import { auth, firestore } from "@/modules/firebase"
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
  isRetryableFirebaseError,
} from "@/utils/firebase/firebase-errors"
import { getBackoffDelay } from "@/utils/firebase/firebase-optimistic"
import {
  compareByCreatedOrder,
  mergeOutboxSnapshots,
  outboxSnapshotsEqual,
  pruneExpiredOperations,
  selectNextOperation,
  shouldDeadLetter,
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
  where,
  type DocumentData,
  type FieldValue,
  type Unsubscribe,
} from "firebase/firestore"
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
const RETRY_BASE_DELAY_MS = 1_000
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

/**
 * Re-export so existing call sites that import these types from this file
 * continue to work. The canonical definitions live alongside the runtime
 * validation schema in `@/schemas/sync`.
 */
export type { SyncMutatePayload, SyncOutboxOperation }

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
  } | null
}

interface SyncEngineState {
  activeUserId: ComputedRef<string | null>
  isRunning: ComputedRef<boolean>
  isOnline: ComputedRef<boolean>
  isProcessing: ComputedRef<boolean>
  pendingCount: ComputedRef<number>
}

interface SyncMetricsState {
  outboxSize: ComputedRef<number>
  pendingCount: ComputedRef<number>
  averageAckLatencyMs: ComputedRef<number>
  totalRetries: ComputedRef<number>
  quarantineCount: ComputedRef<number>
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

type OperationWaiter = {
  resolve: () => void
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

/**
 * Read the outbox a peer tab may have written to the shared localStorage key.
 * Backs the read-modify-write persist and the cross-tab storage listener.
 */
const readStoredOutbox = (): SyncOutboxOperation[] => {
  if (!hasWindow()) return []
  return parseOutbox(window.localStorage.getItem(OUTBOX_STORAGE_KEY)).valid
}

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
    // snapshot with whatever a peer has written since we last read. A blind
    // overwrite would drop a concurrent tab's pending ops and lose them on
    // reload.
    const merged = mergeOutboxSnapshots(
      snapshot,
      readStoredOutbox(),
      Date.now()
    )
    window.localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(merged))
  } catch (error) {
    console.warn("[syncEngine] Failed to persist outbox", error)
  }
}

/**
 * Debounced localStorage write. Bursts of optimistic updates (e.g. rapid
 * keypresses, batch operations) all share a single serialize + write pass.
 * A `beforeunload`/`pagehide` listener ensures the last write is flushed
 * synchronously even if the user navigates away mid-batch.
 */
const persistOutbox = (operations: SyncOutboxOperation[]) => {
  if (!hasWindow()) return
  pendingPersistSnapshot = operations
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
const isSyncing = ref(false)
const isOnline = ref(typeof navigator === "undefined" ? true : navigator.onLine)
const activeUserId = ref<string | null>(auth.currentUser?.uid ?? null)
const clientId = getOrCreateClientId()
const ackSubscribers = new Set<AckSubscriber>()
const canonicalSubscribers = new Set<CanonicalSubscriber>()
const totalAckLatencyMs = ref(0)
const totalAckCount = ref(0)
const totalRetries = ref(0)

let authUnsubscribe: Unsubscribe | null = null
let ackUnsubscribe: Unsubscribe | null = null
let syncTimer: ReturnType<typeof setTimeout> | null = null
let storageSyncCleanup: (() => void) | null = null
// Per-user leader election (Web Locks). Only the leader tab for the active
// user sends; other tabs enqueue + persist and the leader adopts those ops.
let isLeader = false
let leaderUserId: string | null = null
let releaseLeaderLock: (() => void) | null = null

const pendingCount = computed(() => {
  const userId = activeUserId.value
  if (!userId) return 0
  return outbox.value.filter(
    (operation) =>
      operation.userId === userId &&
      (operation.status === "pending" || operation.status === "sent")
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
      operation.userId === userId &&
      (operation.status === "pending" || operation.status === "sent")
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
  if (existing.type !== incoming.type) return false
  if (existing.type === "delete") return false
  if (existing.targetPath !== incoming.targetPath) return false
  if ((existing.merge ?? false) !== (incoming.merge ?? false)) return false
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
    if (op.status !== "pending" || op.attempts > 0) continue
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
      updatedAt: incoming.updatedAt,
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

const settleWaiters = (operationId: string, error?: Error) => {
  const targets = waiters.get(operationId)
  if (!targets || targets.length === 0) return
  waiters.delete(operationId)

  targets.forEach((waiter) => {
    if (error) {
      waiter.reject(error)
      return
    }
    waiter.resolve()
  })
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
    RETRY_BASE_DELAY_MS,
    Math.round(getBackoffDelay(Math.max(attempts - 1, 0), RETRY_BASE_DELAY_MS))
  )

const scheduleSync = (delay = SYNC_BATCH_WINDOW_MS) => {
  if (!isRunning.value) return
  if (syncTimer) {
    clearTimeout(syncTimer)
  }
  syncTimer = setTimeout(() => {
    syncTimer = null
    void processSyncLoop()
  }, delay)
}

const toRemoteDocument = (
  operation: SyncOutboxOperation
): RemoteSyncOperationDocument => {
  const isRejected = operation.status === "rejected"

  return {
    id: operation.id,
    userId: operation.userId,
    clientId: operation.clientId,
    source: operation.source,
    targetPath: operation.targetPath,
    type: operation.type,
    data: operation.data ?? null,
    merge: operation.merge ?? false,
    baseVersion: operation.baseVersion ?? null,
    status:
      operation.status === "acked" ? "ack" : isRejected ? "reject" : "pending",
    attempts: operation.attempts,
    createdAt: serverTimestamp(),
    createdAtClient: operation.createdAt,
    updatedAtClient: operation.updatedAt,
    sentAtClient: operation.sentAt ?? null,
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
  outboxOperation?: SyncOutboxOperation
) => {
  settleWaiters(operationId)

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
  data?: Partial<RemoteSyncOperationDocument>
): boolean => {
  const status = data?.status
  if (status !== "ack" && status !== "reject") return false

  const outboxOperation = outbox.value.find((op) => op.id === operationId)
  if (
    outboxOperation &&
    (outboxOperation.status === "acked" ||
      outboxOperation.status === "rejected")
  ) {
    return true
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
      upsertOperation(operationId, (operation) => ({
        ...operation,
        status: "acked",
        updatedAt: settledAt,
        settledAt,
        errorMessage: undefined,
      }))
      recordAckLatency(outboxOperation)
    }
    notifyAckSubscribers({
      ...eventBase,
      status: "ack",
      message: null,
    })
    settleAckAfterCanonical(operationId, eventBase, outboxOperation)
    return true
  }

  const error = new Error(message ?? "Sync operation rejected")
  if (outboxOperation) {
    upsertOperation(operationId, (operation) => ({
      ...operation,
      status: "rejected",
      updatedAt: settledAt,
      settledAt,
      errorMessage: error.message,
    }))
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

const ensureAckListener = (userId: string) => {
  if (ackUnsubscribe) {
    ackUnsubscribe()
    ackUnsubscribe = null
  }

  // Scope listener to this client's operations to avoid processing
  // stale documents from other tabs/devices as the collection grows
  const ackQuery = query(
    collection(firestore, "users", userId, "syncOperations"),
    where("clientId", "==", clientId)
  )

  ackUnsubscribe = onSnapshot(
    ackQuery,
    (snapshot) => {
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
      console.error("[syncEngine] Failed to listen for operation acks:", error)
      scheduleSync(RETRY_BASE_DELAY_MS)
    }
  )
}

const sendOperation = async (operation: SyncOutboxOperation): Promise<void> => {
  const now = Date.now()
  const isRetryAttempt = operation.attempts > 0
  if (isRetryAttempt) {
    totalRetries.value += 1
  }
  upsertOperation(operation.id, (current) => ({
    ...current,
    status: "sent",
    attempts: current.attempts + 1,
    sentAt: now,
    updatedAt: now,
    errorMessage: undefined,
  }))

  const next = outbox.value.find((candidate) => candidate.id === operation.id)
  if (!next) return

  const operationRef = doc(
    firestore,
    "users",
    operation.userId,
    "syncOperations",
    operation.id
  )

  try {
    await setDoc(operationRef, toRemoteDocument(next), { merge: true })
  } catch (error) {
    const errorCode =
      typeof error === "object" &&
      error &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : null

    if (errorCode === "permission-denied" || errorCode === "invalid-argument") {
      try {
        const remoteOperation = await getDoc(operationRef)
        if (
          remoteOperation.exists() &&
          applyRemoteSettlement(
            operation.id,
            remoteOperation.data() as Partial<RemoteSyncOperationDocument>
          )
        ) {
          return
        }
      } catch (readError) {
        console.warn(
          "[syncEngine] Failed to inspect remote operation state:",
          readError
        )
      }

      const rejectError = new Error(getFirestoreErrorMessage(error))
      const settledAt = Date.now()
      upsertOperation(operation.id, (current) => ({
        ...current,
        status: "rejected",
        updatedAt: settledAt,
        settledAt,
        errorMessage: rejectError.message,
      }))
      settleWaiters(operation.id, rejectError)
      return
    }

    if (!isRetryableFirebaseError(error)) {
      const rejectError = new Error(getFirestoreErrorMessage(error))
      const settledAt = Date.now()
      upsertOperation(operation.id, (current) => ({
        ...current,
        status: "rejected",
        updatedAt: settledAt,
        settledAt,
        errorMessage: rejectError.message,
      }))
      settleWaiters(operation.id, rejectError)
      console.warn("[syncEngine] Non-retryable sync submission error:", error)
      return
    }
    throw error
  }
}

const deadLetterOperation = (
  operation: SyncOutboxOperation,
  reason: string
): void => {
  const settledAt = Date.now()
  upsertOperation(operation.id, (current) => ({
    ...current,
    status: "rejected",
    updatedAt: settledAt,
    settledAt,
    errorMessage: reason,
  }))
  // Preserve the failed payload for inspection (mirrors corrupt-entry
  // quarantine) and fail the caller's waiter with a terminal error instead of
  // leaving it hanging forever.
  appendQuarantinedOutboxEntries([{ ...operation, deadLetterReason: reason }])
  settleWaiters(operation.id, new Error(reason))
}

const processSyncLoop = async () => {
  if (!isRunning.value || isSyncing.value) return
  const userId = activeUserId.value
  if (!userId || !isOnline.value) return
  // Only the elected leader tab for this user sends, so multiple tabs never
  // double-submit the same operation. Non-leaders still enqueue + persist; the
  // leader adopts those ops via the storage listener.
  if (!isLeader) return

  const { ready, nextRetryInMs } = selectNextOperation(
    outbox.value,
    userId,
    Date.now(),
    getRetryDelay
  )

  if (!ready) {
    // Nothing ready now. If something is mid-backoff, wake when it is due
    // rather than stalling the queue.
    if (nextRetryInMs !== null) scheduleSync(nextRetryInMs)
    return
  }

  // A write that has burned through its retry budget is dead-lettered rather
  // than retried forever — which would also head-of-line-block its path.
  if (shouldDeadLetter(ready)) {
    deadLetterOperation(
      ready,
      `Sync operation failed after ${ready.attempts} attempts`
    )
    scheduleSync()
    return
  }

  isSyncing.value = true
  try {
    await sendOperation(ready)
  } catch (error) {
    console.error("[syncEngine] Failed to submit operation:", error)
  } finally {
    isSyncing.value = false
  }

  // Re-evaluate immediately; the next pass schedules a backoff wake if needed.
  scheduleSync()
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
    // recorded — without dropping our own in-flight operations.
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
  pruneSettledOperations()
}

const registerWaiter = (operationId: string): Promise<void> =>
  new Promise<void>((resolve, reject) => {
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
  settled: Promise<void>
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

export async function mutate(payload: SyncMutatePayload): Promise<void> {
  validateMutationPayload(payload)
  const queued = enqueue(payload, { schedule: "microtask" })
  await queued.settled
}

export function getPendingOperations(
  userId: string | null = activeUserId.value
): SyncOutboxOperation[] {
  if (!userId) return []

  return outbox.value.filter(
    (operation) =>
      operation.userId === userId &&
      (operation.status === "pending" || operation.status === "sent")
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
    isProcessing: computed(() => isSyncing.value),
    pendingCount,
  }
}

export function useSyncMetricsState(): SyncMetricsState {
  return {
    outboxSize,
    pendingCount,
    averageAckLatencyMs,
    totalRetries: computed(() => totalRetries.value),
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
