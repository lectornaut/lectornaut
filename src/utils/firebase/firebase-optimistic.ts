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

import { isRetryableFirebaseError } from "@/utils/firebase/firebase-errors"
import type { ComputedRef, Ref } from "vue"
import { computed, isRef, ref, shallowRef } from "vue"

// ============================================================================
// State Cloning
// ============================================================================

/**
 * Deep clones an object to preserve previous state for rollback
 * Optimized for Firestore data structures
 *
 * @param state - The state to clone
 * @returns A deep copy of the state
 */
export function cloneState<T>(state: T): T {
  // Fast path for null/undefined
  if (state == null) return state

  // Fast path for primitives
  if (typeof state !== "object") return state

  // Handle Date objects (including Firestore Timestamps with toDate())
  if (state instanceof Date) {
    return new Date(state.getTime()) as T
  }

  // Handle Arrays - use map for better performance than structuredClone
  if (Array.isArray(state)) {
    return state.map((item) => cloneState(item)) as T
  }

  // Handle Firestore Timestamp-like objects (immutable, no need to clone)
  if ("seconds" in state && "nanoseconds" in state) {
    return state
  }

  // Handle plain objects - try structuredClone first (fastest for large objects)
  try {
    return structuredClone(state)
  } catch {
    // Fallback for objects that can't be cloned (e.g., with functions)
    const cloned = {} as T
    for (const key in state) {
      if (Object.prototype.hasOwnProperty.call(state, key)) {
        ;(cloned as Record<string, unknown>)[key] = cloneState(
          (state as Record<string, unknown>)[key]
        )
      }
    }
    return cloned
  }
}

/**
 * Shallow clone for arrays when deep cloning isn't needed
 * Much faster than cloneState for simple array operations
 */
export function shallowCloneArray<T>(arr: T[]): T[] {
  return [...arr]
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

const DEFAULT_PENDING_RELEASE_DELAY_MS = 900

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
 * Result type for optimistic operations
 */
export interface OptimisticResult<T> {
  success: boolean
  data?: T
  error?: Error
}

/**
 * Options for optimistic operations
 */
export interface OptimisticOptions {
  /** Toast message on success */
  successMessage?: string
  /** Toast message on error */
  errorMessage?: string
  /** Whether to show toast notifications */
  showToasts?: boolean
  /** Maximum retry attempts (default: 0) */
  maxRetries?: number
  /** Base delay for exponential backoff in ms (default: 1000) */
  retryBaseDelay?: number
  /** Track this operation in the global cloud sync queue (default: true) */
  trackSync?: boolean
  /**
   * Keep pending IDs alive briefly after mutation success to absorb Firestore
   * snapshot lag and prevent UI flicker (default: 900ms).
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
    maxRetries = 0,
    retryBaseDelay = 1000,
    trackSync = true,
    pendingReleaseDelayMs = DEFAULT_PENDING_RELEASE_DELAY_MS,
  } = options
  const syncToken = trackSync
    ? beginCloudSyncOperation({ id, source: "withOptimisticUpdate" })
    : null
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
      source: "withOptimisticUpdate",
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
 * Type for array state operations
 */
export interface ArrayStateHelpers<T extends { id: string }> {
  /** Add an item optimistically */
  addItem: (items: Ref<T[]>, item: T) => T[]
  /** Remove an item optimistically, returns previous state */
  removeItem: (items: Ref<T[]>, id: string) => T[]
  /** Update an item optimistically, returns previous state */
  updateItem: (items: Ref<T[]>, id: string, updates: Partial<T>) => T[]
  /** Find an item by ID */
  findItem: (items: Ref<T[]>, id: string) => T | undefined
  /** Restore array to previous state */
  restore: (items: Ref<T[]>, previousState: T[]) => void
}

/**
 * Creates helpers for managing array state with optimistic updates
 */
export function createArrayHelpers<
  T extends { id: string },
>(): ArrayStateHelpers<T> {
  return {
    addItem(items: Ref<T[]>, item: T): T[] {
      const previousState = cloneState(items.value)
      items.value = [...items.value, item]
      return previousState
    },

    removeItem(items: Ref<T[]>, id: string): T[] {
      const previousState = cloneState(items.value)
      items.value = items.value.filter((item) => item.id !== id)
      return previousState
    },

    updateItem(items: Ref<T[]>, id: string, updates: Partial<T>): T[] {
      const previousState = cloneState(items.value)
      items.value = items.value.map((item) =>
        item.id === id ? { ...cloneState(item), ...updates } : item
      )
      return previousState
    },

    findItem(items: Ref<T[]>, id: string): T | undefined {
      return items.value.find((item) => item.id === id)
    },

    restore(items: Ref<T[]>, previousState: T[]): void {
      items.value = previousState
    },
  }
}

/**
 * Type for single object state operations
 */
export interface ObjectStateHelpers<T> {
  /** Update object optimistically, returns previous state */
  updateObject: (obj: Ref<T | null>, updates: Partial<T>) => T | null
  /** Set object optimistically, returns previous state */
  setObject: (obj: Ref<T | null>, newValue: T | null) => T | null
  /** Restore object to previous state */
  restore: (obj: Ref<T | null>, previousState: T | null) => void
}

/**
 * Creates helpers for managing single object state with optimistic updates
 */
export function createObjectHelpers<T>(): ObjectStateHelpers<T> {
  return {
    updateObject(obj: Ref<T | null>, updates: Partial<T>): T | null {
      const previousState = cloneState(obj.value)
      if (obj.value) {
        obj.value = { ...cloneState(obj.value), ...updates }
      }
      return previousState
    },

    setObject(obj: Ref<T | null>, newValue: T | null): T | null {
      const previousState = cloneState(obj.value)
      obj.value = newValue ? cloneState(newValue) : null
      return previousState
    },

    restore(obj: Ref<T | null>, previousState: T | null): void {
      obj.value = previousState
    },
  }
}

/**
 * Creates a snapshot guard that prevents onSnapshot from overwriting
 * optimistic updates while operations are pending
 *
 * @param pendingIds - Set tracking in-flight operations
 * @param getAffectedIds - Function to extract affected IDs from snapshot data
 */
export function createSnapshotGuard<T>(
  pendingIds: Set<string>,
  getAffectedIds: (data: T) => string[]
): (data: T, apply: (data: T) => void) => void {
  return (data: T, apply: (data: T) => void) => {
    const affectedIds = getAffectedIds(data)
    const hasPendingOperations = affectedIds.some((id) => pendingIds.has(id))

    if (!hasPendingOperations) {
      apply(data)
    }
    // If there are pending operations, skip the snapshot update
    // The optimistic state will be reconciled when the operation completes
  }
}

/**
 * Utility to generate a unique operation ID for new documents
 */
export function generateOperationId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}
