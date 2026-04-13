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
  getFirestoreErrorMessage,
  isRetryableFirebaseError,
} from "@/utils/firebase/firebase-errors"
import {
  beginCloudSyncOperation,
  endCloudSyncOperation,
  getBackoffDelay,
  optimisticUpdater,
  type PendingCollection,
} from "@/utils/firebase/firebase-optimistic"
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
const OUTBOX_SETTLED_RETENTION_MS = 60 * 60 * 1000
const OUTBOX_MAX_PENDING_PER_USER = 2_000
const RETRY_BASE_DELAY_MS = 1_000
const CANONICAL_WAIT_TIMEOUT_MS = 6_000
const SYNC_BATCH_WINDOW_MS = 50

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
  return valid.sort(byCreatedOrder)
}

const persistOutbox = (operations: SyncOutboxOperation[]) => {
  if (!hasWindow()) return
  window.localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(operations))
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

const byCreatedOrder = (a: SyncOutboxOperation, b: SyncOutboxOperation) => {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt
  }
  return a.id.localeCompare(b.id)
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
const userScanCursor = new Map<string, number>()

let authUnsubscribe: Unsubscribe | null = null
let ackUnsubscribe: Unsubscribe | null = null
let syncTimer: ReturnType<typeof setTimeout> | null = null

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

const tryCoalesceOperation = (
  incoming: SyncOutboxOperation
): { operationId: string; coalesced: boolean } | null => {
  let result: { operationId: string; coalesced: boolean } | null = null
  let changed = false

  updateOutbox((operations) => {
    const next = [...operations]

    for (let index = next.length - 1; index >= 0; index--) {
      const existing = next[index]
      if (!existing || !canCoalesceOperation(existing, incoming)) continue

      const mergedData = {
        ...(existing.data ?? {}),
        ...(incoming.data ?? {}),
      }

      next[index] = {
        ...existing,
        data: mergedData,
        source: incoming.source,
        updatedAt: incoming.updatedAt,
      }
      changed = true

      result = { operationId: existing.id, coalesced: true }
      break
    }

    return changed ? next : operations
  })

  return result
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
  updateOutbox((operations) =>
    operations.filter((operation) => {
      if (operation.status !== "acked" && operation.status !== "rejected") {
        return true
      }
      const settledAt = operation.settledAt ?? operation.updatedAt
      return now - settledAt <= OUTBOX_SETTLED_RETENTION_MS
    })
  )
}

const getNextOperation = (userId: string): SyncOutboxOperation | null => {
  const operations = outbox.value
  if (operations.length === 0) return null

  const start = Math.min(
    userScanCursor.get(userId) ?? 0,
    Math.max(operations.length - 1, 0)
  )
  const isEligible = (operation: SyncOutboxOperation) =>
    operation.userId === userId &&
    (operation.status === "pending" || operation.status === "sent")

  for (let index = start; index < operations.length; index++) {
    const operation = operations[index]
    if (!operation || !isEligible(operation)) continue
    userScanCursor.set(userId, index)
    return operation
  }

  for (let index = 0; index < start; index++) {
    const operation = operations[index]
    if (!operation || !isEligible(operation)) continue
    userScanCursor.set(userId, index)
    return operation
  }

  userScanCursor.set(userId, 0)
  return null
}

const getRetryDelay = (attempts: number): number =>
  Math.max(
    RETRY_BASE_DELAY_MS,
    Math.round(getBackoffDelay(Math.max(attempts - 1, 0), RETRY_BASE_DELAY_MS))
  )

const getRetryIn = (operation: SyncOutboxOperation): number => {
  if (operation.status === "pending") return 0
  if (operation.status !== "sent" || !operation.sentAt) return 0
  const delay = getRetryDelay(operation.attempts)
  const elapsed = Date.now() - operation.sentAt
  return Math.max(0, delay - elapsed)
}

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

const settleAckAfterCanonical = (
  operationId: string,
  eventBase: {
    userId: string
    targetPath: string
    at: number
  },
  outboxOperation?: SyncOutboxOperation
) => {
  const finalize = () => {
    notifyCanonicalSubscribers({
      userId: eventBase.userId,
      targetPath: eventBase.targetPath,
      origin: "local",
      operationId,
      at: Date.now(),
    })
    settleWaiters(operationId)
  }

  if (!outboxOperation) {
    finalize()
    return
  }

  void waitForCanonicalDocumentState(outboxOperation)
    .catch((error) => {
      console.warn(
        "[syncEngine] Canonical wait failed; proceeding with waiter settlement:",
        error
      )
    })
    .finally(() => {
      finalize()
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

const processSyncLoop = async () => {
  if (!isRunning.value || isSyncing.value) return
  const userId = activeUserId.value
  if (!userId || !isOnline.value) return

  const operation = getNextOperation(userId)
  if (!operation) return

  const retryIn = getRetryIn(operation)
  if (retryIn > 0) {
    scheduleSync(retryIn)
    return
  }

  isSyncing.value = true
  try {
    await sendOperation(operation)
  } catch (error) {
    console.error("[syncEngine] Failed to submit operation:", error)
  } finally {
    isSyncing.value = false
  }

  const latest = outbox.value.find((candidate) => candidate.id === operation.id)
  if (!latest) {
    scheduleSync()
    return
  }

  if (latest.status === "rejected" || latest.status === "acked") {
    scheduleSync()
    return
  }

  scheduleSync(getRetryIn(latest))
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

  if (!isRunning.value || !nextUserId) return
  ensureAckListener(nextUserId)
  scheduleSync()
}

const ensureAuthListener = () => {
  if (authUnsubscribe) return

  authUnsubscribe = onIdTokenChanged(auth, (user) => {
    handleUserChange(user?.uid ?? null)
  })
}

let onlineCleanup: (() => void) | null = null

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

let initialized = false

const ensureInitialized = () => {
  if (initialized) return
  initialized = true
  ensureAuthListener()
  ensureOnlineListeners()
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
  userScanCursor.delete(userId)
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
  if (activeUserId.value) {
    rejectWaitersForUser(activeUserId.value, "Sync stopped")
  }
}

/**
 * Validate a mutation payload against the path's registered schema, if any.
 *
 * This is the single choke point for write-side validation — every mutation
 * helper (`mutateSetDocument`, `mutateUpdateDocument`, `mutateDeleteDocument`,
 * `mutateWithCoordinator`) funnels through `mutate()`, so adding validation
 * here covers all of them with one change.
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

/**
 * Optimistic outbox mutation.
 *
 * Applies `applyLocal` immediately to Pinia state, enqueues `mutation` on the
 * sync outbox, commits the receipt on ack or rolls back on failure. All writes
 * that need offline durability, server ACKs, or queue metrics should go
 * through here rather than calling `enqueue` + `optimisticUpdater` by hand.
 */
export interface MutateWithCoordinatorOptions {
  id: string
  pendingIds: PendingCollection
  applyLocal: () => void
  rollbackLocal: () => void
  mutation: SyncMutatePayload
  source?: string
  pendingReleaseDelayMs?: number
}

export async function mutateWithCoordinator(
  options: MutateWithCoordinatorOptions
): Promise<void> {
  const source = options.source ?? options.mutation.source
  const receipt = optimisticUpdater.applyLocal({
    id: options.id,
    source,
    pendingIds: options.pendingIds,
    applyLocal: options.applyLocal,
    rollback: options.rollbackLocal,
    pendingReleaseDelayMs: options.pendingReleaseDelayMs,
  })

  const syncToken = beginCloudSyncOperation({ id: options.id, source })
  let syncError: unknown

  try {
    await mutate(options.mutation)
    optimisticUpdater.commit(receipt)
  } catch (error) {
    syncError = error
    optimisticUpdater.rollback(receipt)
    throw error
  } finally {
    endCloudSyncOperation(syncToken, syncError)
  }
}
