/**
 * Optimistic Update Utilities for Firestore + Pinia
 *
 * Provides utilities for implementing optimistic updates with proper rollback
 * support, pending operation tracking, and snapshot protection.
 *
 * Key Features:
 * - Type-safe optimistic updates with automatic rollback
 * - Pending operation tracking with reactive triggers
 * - Retry logic with exponential backoff
 * - Snapshot protection: keeps optimistic cache writes from being clobbered by
 *   the live `onSnapshot` listener (the hold/stash machinery in
 *   `firebase-query.ts`; this file's merge/receipt helpers back that path).
 */

import { generateId } from "@/helpers/utilities"
import type { ComputedRef, Ref } from "vue"
import { computed, ref, shallowRef, toRaw } from "vue"

// ============================================================================
// State Cloning
// ============================================================================

/**
 * Deep clones an object to preserve previous state for rollback.
 *
 * Recursively unwraps Vue reactive proxies (toRaw) and clones arrays/objects.
 * Firestore Timestamp-like objects are shared by reference so their class
 * identity (and `toDate()`) survives the clone — `structuredClone` would
 * strip the prototype and break every `value.toDate()` call downstream.
 * Dates are cloned defensively because they are mutable.
 */
function deepClone<T>(value: T): T {
  const raw = toRaw(value)

  if (raw == null || typeof raw !== "object") return raw

  // Firestore Timestamp-like objects are immutable — preserve identity so
  // `toDate()` and sort comparators keep working after cloning.
  if ("seconds" in (raw as object) && "nanoseconds" in (raw as object)) {
    return raw
  }

  if (raw instanceof Date) {
    return new Date(raw.getTime()) as T
  }

  if (Array.isArray(raw)) {
    return raw.map(deepClone) as T
  }

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    result[key] = deepClone((raw as Record<string, unknown>)[key])
  }
  return result as T
}

export function cloneState<T>(state: T): T {
  return deepClone(state)
}

// ============================================================================
// Pending Set Management
// ============================================================================

/**
 * Creates a reactive Set for tracking pending operation IDs
 * Used to disable UI actions during in-flight operations
 */
export function createPendingSet(): Set<string> {
  return new Set<string>()
}

const pendingCountsByRef = new WeakMap<Ref<Set<string>>, Map<string, number>>()

const getPendingCountsForRef = (pendingRef: Ref<Set<string>>) => {
  let counts = pendingCountsByRef.get(pendingRef)
  if (!counts) {
    counts = new Map<string, number>()
    pendingCountsByRef.set(pendingRef, counts)
  }
  return counts
}

/**
 * Triggers reactivity for a Ref<Set>
 * Call this after modifying the set to ensure Vue detects the change
 */
export function triggerPendingUpdate(pendingRef: Ref<Set<string>>): void {
  pendingRef.value = new Set(pendingRef.value)
}

/**
 * Add an ID to pending set with reactivity trigger
 */
export function addPending(pendingRef: Ref<Set<string>>, id: string): void {
  const counts = getPendingCountsForRef(pendingRef)
  const nextCount = (counts.get(id) ?? 0) + 1
  counts.set(id, nextCount)

  if (nextCount === 1 || !pendingRef.value.has(id)) {
    pendingRef.value.add(id)
    triggerPendingUpdate(pendingRef)
  }
}

/**
 * Remove an ID from pending set with reactivity trigger
 */
export function removePending(pendingRef: Ref<Set<string>>, id: string): void {
  const counts = getPendingCountsForRef(pendingRef)
  const currentCount = counts.get(id) ?? 0

  if (currentCount <= 1) {
    counts.delete(id)
    if (pendingRef.value.delete(id)) {
      triggerPendingUpdate(pendingRef)
    }
    return
  }

  counts.set(id, currentCount - 1)
}

// ============================================================================
// Global Cloud Sync Queue
// ============================================================================

export interface CloudSyncOperationOptions {
  id?: string
  source?: string
}

export type CloudSyncErrorResetPolicy = "on_start" | "on_success" | "manual"

interface CloudSyncOperation {
  token: number
  id?: string
  source?: string
  startedAt: number
}

const activeCloudSyncOperations = shallowRef(
  new Map<number, CloudSyncOperation>()
)
const totalCloudSyncStarted = ref(0)
const totalCloudSyncSucceeded = ref(0)
const totalCloudSyncFailed = ref(0)
const lastCloudSyncSuccessAt = ref<number | null>(null)
const lastCloudSyncErrorAt = ref<number | null>(null)
const lastCloudSyncErrorMessage = ref<string | null>(null)
const cloudSyncErrorResetPolicy = ref<CloudSyncErrorResetPolicy>("on_start")
let cloudSyncTokenCounter = 0

const cloudSyncActiveCount = computed(
  () => activeCloudSyncOperations.value.size
)
const cloudSyncIsSyncing = computed(() => cloudSyncActiveCount.value > 0)
const cloudSyncHasError = computed(
  () => lastCloudSyncErrorMessage.value !== null
)

const toCloudSyncErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error
  }
  try {
    const serialized = JSON.stringify(error)
    if (serialized && serialized !== "{}") {
      return serialized
    }
  } catch {
    // ignore serialization errors and fallback to generic message
  }
  return "Cloud sync failed"
}

const setActiveCloudSyncOperation = (operation: CloudSyncOperation): void => {
  const next = new Map(activeCloudSyncOperations.value)
  next.set(operation.token, operation)
  activeCloudSyncOperations.value = next
}

const clearActiveCloudSyncOperation = (token: number): boolean => {
  if (!activeCloudSyncOperations.value.has(token)) return false
  const next = new Map(activeCloudSyncOperations.value)
  next.delete(token)
  activeCloudSyncOperations.value = next
  return true
}

export function clearCloudSyncError(): void {
  lastCloudSyncErrorMessage.value = null
  lastCloudSyncErrorAt.value = null
}

export function setCloudSyncErrorResetPolicy(
  policy: CloudSyncErrorResetPolicy
): void {
  cloudSyncErrorResetPolicy.value = policy
}

export function beginCloudSyncOperation(
  options: CloudSyncOperationOptions = {}
): number {
  if (cloudSyncErrorResetPolicy.value === "on_start") {
    clearCloudSyncError()
  }

  const token = ++cloudSyncTokenCounter
  totalCloudSyncStarted.value += 1

  setActiveCloudSyncOperation({
    token,
    id: options.id,
    source: options.source,
    startedAt: Date.now(),
  })

  return token
}

export function endCloudSyncOperation(token: number, error?: unknown): void {
  const removed = clearActiveCloudSyncOperation(token)
  if (!removed) return

  if (error !== undefined) {
    totalCloudSyncFailed.value += 1
    lastCloudSyncErrorAt.value = Date.now()
    lastCloudSyncErrorMessage.value = toCloudSyncErrorMessage(error)
    return
  }

  totalCloudSyncSucceeded.value += 1
  lastCloudSyncSuccessAt.value = Date.now()
  if (cloudSyncErrorResetPolicy.value === "on_success") {
    clearCloudSyncError()
  }
}

export async function withCloudSyncOperation<T>(
  operation: () => Promise<T>,
  options: CloudSyncOperationOptions = {}
): Promise<T> {
  const token = beginCloudSyncOperation(options)
  let syncError: unknown

  try {
    return await operation()
  } catch (error) {
    syncError = error
    throw error
  } finally {
    endCloudSyncOperation(token, syncError)
  }
}

export interface CloudSyncQueueState {
  activeCount: ComputedRef<number>
  isSyncing: ComputedRef<boolean>
  hasError: ComputedRef<boolean>
  lastErrorMessage: ComputedRef<string | null>
  lastErrorAt: ComputedRef<number | null>
  lastSuccessAt: ComputedRef<number | null>
  totalStarted: ComputedRef<number>
  totalSucceeded: ComputedRef<number>
  totalFailed: ComputedRef<number>
  errorResetPolicy: ComputedRef<CloudSyncErrorResetPolicy>
  clearError: () => void
  setErrorResetPolicy: (policy: CloudSyncErrorResetPolicy) => void
}

export function useCloudSyncQueueState(): CloudSyncQueueState {
  return {
    activeCount: cloudSyncActiveCount,
    isSyncing: cloudSyncIsSyncing,
    hasError: cloudSyncHasError,
    lastErrorMessage: computed(() => lastCloudSyncErrorMessage.value),
    lastErrorAt: computed(() => lastCloudSyncErrorAt.value),
    lastSuccessAt: computed(() => lastCloudSyncSuccessAt.value),
    totalStarted: computed(() => totalCloudSyncStarted.value),
    totalSucceeded: computed(() => totalCloudSyncSucceeded.value),
    totalFailed: computed(() => totalCloudSyncFailed.value),
    errorResetPolicy: computed(() => cloudSyncErrorResetPolicy.value),
    clearError: clearCloudSyncError,
    setErrorResetPolicy: setCloudSyncErrorResetPolicy,
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Helper to check if an operation is pending
 */
export function isPending(pendingIds: Set<string>, id: string): boolean {
  return pendingIds.has(id)
}

/**
 * Helper to check if any operation is pending for a set of IDs
 */
export function hasAnyPending(pendingIds: Set<string>, ids: string[]): boolean {
  return ids.some((id) => pendingIds.has(id))
}

/**
 * Sleep helper for retry delays
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Calculate exponential backoff delay with jitter
 * Jitter helps prevent thundering herd problems when multiple retries happen simultaneously
 */
export function getBackoffDelay(attempt: number, baseDelay: number): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt)
  // Add jitter (±25%) to prevent thundering herd
  const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1)
  return Math.min(exponentialDelay + jitter, 30000) // Max 30 seconds
}

/**
 * Builds a re-entrancy-safe cloud persister around the "persist with a
 * single-slot queue" pattern several stores share.
 *
 * While a write is in flight, further `trigger()` calls don't stack — they set
 * a queued flag, and exactly one follow-up write runs after the current one
 * settles (collapsing a burst into at most one trailing write). The write is
 * wrapped in `withCloudSyncOperation` for telemetry. Pair with a debounced
 * watcher (e.g. VueUse `watchDebounced`) for the time-based debounce.
 *
 * The `pending` ref is RETURNED because callers commonly read it elsewhere —
 * e.g. an inbound snapshot watch skips applying remote state while a local
 * write is pending, so it can't clobber the in-flight edit.
 *
 * @param options.persist    Performs the write; returns false on failure (e.g.
 *   a null doc ref). A false result is surfaced as an error to telemetry.
 * @param options.id         Stable operation id for the cloud sync queue.
 * @param options.source     Telemetry source tag.
 * @param options.canPersist Optional pre-check; when it returns false, trigger
 *   is a no-op (e.g. there's no target doc ref yet).
 * @param options.errorLabel Console-error prefix on failure (defaults to id).
 */
export function createDebouncedCloudSync(options: {
  persist: () => Promise<boolean>
  id: string
  source: string
  canPersist?: () => boolean
  errorLabel?: string
}): { trigger: () => Promise<void>; pending: Ref<boolean> } {
  const { persist, id, source, canPersist, errorLabel = id } = options
  const pending = shallowRef(false)
  const isQueued = ref(false)

  const trigger = async (): Promise<void> => {
    if (canPersist && !canPersist()) return

    // Already persisting: remember to run exactly one more time after, then bail.
    if (pending.value) {
      isQueued.value = true
      return
    }

    pending.value = true
    isQueued.value = false

    try {
      await withCloudSyncOperation(
        async () => {
          const success = await persist()
          if (!success) throw new Error(`Failed to persist ${id}`)
        },
        { id, source }
      )
    } catch (error) {
      console.error(`[createDebouncedCloudSync:${errorLabel}] failed:`, error)
    } finally {
      pending.value = false
      // Drain the single queued slot: a trigger that arrived mid-flight.
      if (isQueued.value) {
        void trigger()
      }
    }
  }

  return { trigger, pending }
}

/**
 * Utility to generate a unique operation ID for new documents
 */
export function generateOperationId(): string {
  return generateId()
}
