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
 * - Snapshot protection to prevent VueFire overwrites
 */

import { generateId } from "@/helpers/utilities"
import { isRetryableFirebaseError } from "@/utils/firebase/firebase-errors"
import type { ComputedRef, Ref } from "vue"
import { computed, isRef, ref, shallowRef, toRaw } from "vue"

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
const pendingCountsBySet = new WeakMap<Set<string>, Map<string, number>>()

const getPendingCountsForRef = (pendingRef: Ref<Set<string>>) => {
  let counts = pendingCountsByRef.get(pendingRef)
  if (!counts) {
    counts = new Map<string, number>()
    pendingCountsByRef.set(pendingRef, counts)
  }
  return counts
}

const getPendingCountsForSet = (pendingSet: Set<string>) => {
  let counts = pendingCountsBySet.get(pendingSet)
  if (!counts) {
    counts = new Map<string, number>()
    pendingCountsBySet.set(pendingSet, counts)
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

export type PendingCollection = Set<string> | Ref<Set<string>>
export type OptimisticMutationState = "pending" | "acked" | "rejected"

export interface OptimisticMutationReceipt {
  id: string
  source?: string
  startedAt: number
  settledAt: number | null
  state: OptimisticMutationState
}

interface InternalOptimisticMutationReceipt extends OptimisticMutationReceipt {
  pendingRef: Ref<Set<string>> | null
  pendingSet: Set<string> | null
  rollback: () => void
  pendingReleaseDelayMs: number
}

interface ApplyLocalMutationOptions {
  id: string
  pendingIds: PendingCollection
  applyLocal: () => void
  rollback: () => void
  source?: string
  pendingReleaseDelayMs?: number
}

const toPendingHandle = (
  pendingIds: PendingCollection
): { pendingRef: Ref<Set<string>> | null; pendingSet: Set<string> | null } => {
  if (isRef(pendingIds)) {
    return {
      pendingRef: pendingIds as Ref<Set<string>>,
      pendingSet: null,
    }
  }
  return {
    pendingRef: null,
    pendingSet: pendingIds,
  }
}

const addPendingForHandle = (
  pendingRef: Ref<Set<string>> | null,
  pendingSet: Set<string> | null,
  id: string
) => {
  if (pendingRef) {
    addPending(pendingRef, id)
    return
  }
  if (!pendingSet) return
  const counts = getPendingCountsForSet(pendingSet)
  const nextCount = (counts.get(id) ?? 0) + 1
  counts.set(id, nextCount)
  if (nextCount === 1) {
    pendingSet.add(id)
  }
}

const removePendingForHandle = (
  pendingRef: Ref<Set<string>> | null,
  pendingSet: Set<string> | null,
  id: string
) => {
  if (pendingRef) {
    removePending(pendingRef, id)
    return
  }
  if (!pendingSet) return
  const counts = getPendingCountsForSet(pendingSet)
  const currentCount = counts.get(id) ?? 0
  if (currentCount <= 1) {
    counts.delete(id)
    pendingSet.delete(id)
    return
  }
  counts.set(id, currentCount - 1)
}

/**
 * Brief hold applied after a mutation's server ack before we clear the
 * pending-id entry. Absorbs the ~1-frame gap between the Firestore ack and
 * the live onSnapshot tick so the UI doesn't flicker between optimistic and
 * server state. 900ms was the prior default; aggressive testing showed most
 * snapshot lag resolves in <100ms when the sync engine's canonical wait is
 * non-blocking, so 120ms is a comfortable safety margin without feeling
 * sluggish.
 */
const DEFAULT_PENDING_RELEASE_DELAY_MS = 120

export function applyLocalMutation(
  options: ApplyLocalMutationOptions
): OptimisticMutationReceipt {
  const startedAt = Date.now()
  const { pendingRef, pendingSet } = toPendingHandle(options.pendingIds)

  addPendingForHandle(pendingRef, pendingSet, options.id)
  options.applyLocal()

  return {
    id: options.id,
    source: options.source,
    startedAt,
    settledAt: null,
    state: "pending",
    pendingRef,
    pendingSet,
    rollback: options.rollback,
    pendingReleaseDelayMs:
      options.pendingReleaseDelayMs ?? DEFAULT_PENDING_RELEASE_DELAY_MS,
  } as InternalOptimisticMutationReceipt
}

export function commitLocalMutation(
  receipt: OptimisticMutationReceipt
): OptimisticMutationReceipt {
  const internal = receipt as InternalOptimisticMutationReceipt
  if (internal.state !== "pending") return internal

  const releasePending = () => {
    removePendingForHandle(
      internal.pendingRef,
      internal.pendingSet,
      internal.id
    )
  }
  const releaseDelayMs = Math.max(0, internal.pendingReleaseDelayMs)
  if (releaseDelayMs > 0) {
    setTimeout(releasePending, releaseDelayMs)
  } else {
    releasePending()
  }
  internal.state = "acked"
  internal.settledAt = Date.now()

  return internal
}

export function rollbackLocalMutation(
  receipt: OptimisticMutationReceipt
): OptimisticMutationReceipt {
  const internal = receipt as InternalOptimisticMutationReceipt
  if (internal.state !== "pending") return internal

  internal.rollback()
  removePendingForHandle(internal.pendingRef, internal.pendingSet, internal.id)
  internal.state = "rejected"
  internal.settledAt = Date.now()

  return internal
}

export const optimisticUpdater = {
  applyLocal: applyLocalMutation,
  commit: commitLocalMutation,
  rollback: rollbackLocalMutation,
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
// Optimistic Update Types
// ============================================================================

/**
 * Options for optimistic operations
 */
export interface OptimisticOptions {
  /** Telemetry source tag for the cloud sync queue and mutation receipt */
  source?: string
  /** Maximum retry attempts (default: 0) */
  maxRetries?: number
  /** Base delay for exponential backoff in ms (default: 1000) */
  retryBaseDelay?: number
  /** Track this operation in the global cloud sync queue (default: true) */
  trackSync?: boolean
  /**
   * Keep pending IDs alive briefly after mutation success to absorb Firestore
   * snapshot lag and prevent UI flicker (default: 120ms).
   */
  pendingReleaseDelayMs?: number
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

// ============================================================================
// Core Optimistic Update Function
// ============================================================================

/**
 * Wraps a Firestore write operation with optimistic update logic
 * Includes optional retry support with exponential backoff
 *
 * @param pendingIds - Set (or shallow ref to set) tracking in-flight operations
 * @param id - Unique identifier for this operation
 * @param applyOptimistic - Function to apply the optimistic update to local state
 * @param rollback - Function to revert to previous state on failure
 * @param firestoreOperation - The actual Firestore write operation
 * @param options - Optional configuration for retries
 */
export async function withOptimisticUpdate<T>(
  pendingIds: PendingCollection,
  id: string,
  applyOptimistic: () => void,
  rollback: () => void,
  firestoreOperation: () => Promise<T>,
  options: OptimisticOptions = {}
): Promise<T> {
  const {
    source = "withOptimisticUpdate",
    maxRetries = 0,
    retryBaseDelay = 1000,
    trackSync = true,
    pendingReleaseDelayMs = DEFAULT_PENDING_RELEASE_DELAY_MS,
  } = options
  const syncToken = trackSync ? beginCloudSyncOperation({ id, source }) : null
  let syncError: unknown
  let receipt: OptimisticMutationReceipt | null = null
  const runFirestoreOperation = () =>
    new Promise<T>((resolve, reject) => {
      queueMicrotask(() => {
        void firestoreOperation().then(resolve).catch(reject)
      })
    })

  try {
    // Apply optimistic update immediately (sync fast path)
    receipt = optimisticUpdater.applyLocal({
      id,
      source,
      pendingIds,
      applyLocal: applyOptimistic,
      rollback,
      pendingReleaseDelayMs,
    })

    let lastError: Error | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Perform the actual Firestore operation
        return await runFirestoreOperation()
      } catch (error) {
        lastError = error as Error

        // Don't retry non-retryable errors or on final attempt
        if (!isRetryableFirebaseError(error) || attempt >= maxRetries) {
          throw error
        }

        const delay = getBackoffDelay(attempt, retryBaseDelay)
        console.warn(
          `Firestore operation failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms:`,
          error
        )
        await sleep(delay)
      }
    }

    throw lastError ?? new Error("Operation failed after retries")
  } catch (error) {
    syncError = error
    if (receipt) {
      try {
        optimisticUpdater.rollback(receipt)
      } catch (rollbackError) {
        console.error(
          `[withOptimisticUpdate] Rollback failed for operation "${id}"`,
          rollbackError
        )
      }
    }
    throw error
  } finally {
    if (receipt && receipt.state === "pending") {
      optimisticUpdater.commit(receipt)
    }
    if (syncToken !== null) {
      endCloudSyncOperation(syncToken, syncError)
    }
  }
}

/**
 * Wraps an async mutation that affects multiple document IDs with optimistic
 * local state and shared pending tracking.
 */
export async function withOptimisticBatchUpdate<T>(
  pendingIds: PendingCollection,
  ids: string[],
  applyOptimistic: () => void,
  rollback: () => void,
  operation: () => Promise<T>,
  options: OptimisticOptions & { source?: string } = {}
): Promise<T> {
  const {
    trackSync = true,
    pendingReleaseDelayMs = DEFAULT_PENDING_RELEASE_DELAY_MS,
    source = "withOptimisticBatchUpdate",
  } = options
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)))

  if (uniqueIds.length === 0) {
    return await operation()
  }

  const { pendingRef, pendingSet } = toPendingHandle(pendingIds)
  const syncToken = trackSync
    ? beginCloudSyncOperation({
        id: uniqueIds.length === 1 ? uniqueIds[0] : source,
        source,
      })
    : null
  let syncError: unknown
  let applied = false

  const releasePending = () => {
    uniqueIds.forEach((id) => {
      removePendingForHandle(pendingRef, pendingSet, id)
    })
  }

  try {
    uniqueIds.forEach((id) => {
      addPendingForHandle(pendingRef, pendingSet, id)
    })
    applyOptimistic()
    applied = true

    const result = await new Promise<T>((resolve, reject) => {
      queueMicrotask(() => {
        void operation().then(resolve).catch(reject)
      })
    })

    const releaseDelayMs = Math.max(0, pendingReleaseDelayMs)
    if (releaseDelayMs > 0) {
      setTimeout(releasePending, releaseDelayMs)
    } else {
      releasePending()
    }

    return result
  } catch (error) {
    syncError = error
    if (applied) {
      try {
        rollback()
      } catch (rollbackError) {
        console.error(
          `[withOptimisticBatchUpdate] Rollback failed for ids "${uniqueIds.join(",")}"`,
          rollbackError
        )
      }
    }
    releasePending()
    throw error
  } finally {
    if (syncToken !== null) {
      endCloudSyncOperation(syncToken, syncError)
    }
  }
}

/**
 * Merges live snapshot data with optimistic local state.
 *
 * - Optimistic entries replace live ones with the same ID.
 * - Pending deletions are represented by missing optimistic entries.
 * - Optimistic-only entries stay visible until the live snapshot catches up.
 */
export function mergeOptimisticCollectionByKey<T>(
  persisted: T[],
  optimistic: T[],
  pendingIds: ReadonlySet<string>,
  getKey: (item: T) => string,
  options: {
    sort?: (a: T, b: T) => number
    includeOptimistic?: (item: T) => boolean
  } = {}
): T[] {
  const optimisticByKey = new Map(
    optimistic
      .filter((item) => options.includeOptimistic?.(item) ?? true)
      .map((item) => [getKey(item), item])
  )
  const merged: T[] = []

  persisted.forEach((item) => {
    const key = getKey(item)
    if (pendingIds.has(key) && !optimisticByKey.has(key)) {
      return
    }

    const optimisticItem = optimisticByKey.get(key)
    merged.push(optimisticItem ?? item)
    optimisticByKey.delete(key)
  })

  optimisticByKey.forEach((item, key) => {
    if (!pendingIds.has(key)) return
    merged.push(item)
  })

  if (options.sort) {
    merged.sort(options.sort)
  }

  return merged
}

export function mergeOptimisticCollection<T extends { id: string }>(
  persisted: T[],
  optimistic: T[],
  pendingIds: ReadonlySet<string>,
  options: { sort?: (a: T, b: T) => number } = {}
): T[] {
  return mergeOptimisticCollectionByKey(
    persisted,
    optimistic,
    pendingIds,
    (item) => item.id,
    options
  )
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
