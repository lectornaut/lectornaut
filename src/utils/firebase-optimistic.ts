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

import type { Ref, ShallowRef } from "vue"

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

/**
 * Triggers reactivity for a ShallowRef<Set>
 * Call this after modifying the set to ensure Vue detects the change
 */
export function triggerPendingUpdate(
  pendingRef: ShallowRef<Set<string>>
): void {
  pendingRef.value = new Set(pendingRef.value)
}

/**
 * Add an ID to pending set with reactivity trigger
 */
export function addPending(
  pendingRef: ShallowRef<Set<string>>,
  id: string
): void {
  pendingRef.value.add(id)
  triggerPendingUpdate(pendingRef)
}

/**
 * Remove an ID from pending set with reactivity trigger
 */
export function removePending(
  pendingRef: ShallowRef<Set<string>>,
  id: string
): void {
  pendingRef.value.delete(id)
  triggerPendingUpdate(pendingRef)
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
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Calculate exponential backoff delay
 */
function getBackoffDelay(attempt: number, baseDelay: number): number {
  return Math.min(baseDelay * Math.pow(2, attempt), 30000) // Max 30 seconds
}

// ============================================================================
// Core Optimistic Update Function
// ============================================================================

/**
 * Wraps a Firestore write operation with optimistic update logic
 * Includes optional retry support with exponential backoff
 *
 * @param pendingIds - Set tracking in-flight operations
 * @param id - Unique identifier for this operation
 * @param applyOptimistic - Function to apply the optimistic update to local state
 * @param rollback - Function to revert to previous state on failure
 * @param firestoreOperation - The actual Firestore write operation
 * @param options - Optional configuration for retries
 */
export async function withOptimisticUpdate<T>(
  pendingIds: Set<string>,
  id: string,
  applyOptimistic: () => void,
  rollback: () => void,
  firestoreOperation: () => Promise<T>,
  options: OptimisticOptions = {}
): Promise<T> {
  const { maxRetries = 0, retryBaseDelay = 1000 } = options

  // Add to pending set
  pendingIds.add(id)

  try {
    // Apply optimistic update immediately
    applyOptimistic()

    let lastError: Error | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Perform the actual Firestore operation
        return await firestoreOperation()
      } catch (error) {
        lastError = error as Error

        // Don't retry on final attempt
        if (attempt < maxRetries) {
          const delay = getBackoffDelay(attempt, retryBaseDelay)
          console.warn(
            `Firestore operation failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms:`,
            error
          )
          await sleep(delay)
        }
      }
    }

    // All retries exhausted - rollback
    rollback()
    throw lastError
  } finally {
    // Always clean up pending state
    pendingIds.delete(id)
  }
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
