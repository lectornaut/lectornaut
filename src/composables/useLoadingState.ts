import type { ComputedRef, Ref } from "vue"

/**
 * Result type for loading operations
 */
export interface LoadingResult<T> {
  data?: T
  error?: Error
}

/**
 * A unified loading state manager for async operations.
 * Provides a type-safe way to track multiple concurrent loading states.
 *
 * @example
 * ```ts
 * const { isLoading, withLoading, isAnyLoading } = useLoadingState<'save' | 'delete'>()
 *
 * // Start a loading operation
 * await withLoading('save', async () => {
 *   await saveData()
 * })
 *
 * // Check loading state
 * if (isLoading('save')) {
 *   // show spinner
 * }
 * ```
 */
export function useLoadingState<T extends string = string>() {
  const loadingMap = ref<Record<string, boolean>>({}) as Ref<Record<T, boolean>>

  /**
   * Check if a specific operation is loading.
   * @param key - The operation key to check.
   * @returns True if the operation is in progress.
   */
  const isLoading = (key: T): boolean => loadingMap.value[key] ?? false

  /**
   * Computed ref that returns true if any operation is loading.
   */
  const isAnyLoading: ComputedRef<boolean> = computed(() =>
    Object.values(loadingMap.value).some(Boolean)
  )

  /**
   * Get all currently loading operation keys.
   */
  const loadingKeys: ComputedRef<T[]> = computed(() =>
    Object.entries(loadingMap.value)
      .filter(([, loading]) => loading)
      .map(([key]) => key as T)
  )

  /**
   * Wrap an async function with loading state management.
   * Automatically sets loading to true before execution and false after.
   *
   * @param key - The operation key to track.
   * @param fn - The async function to execute.
   * @returns The result of the async function, or undefined if it threw.
   */
  const withLoading = async <R>(
    key: T,
    fn: () => Promise<R>
  ): Promise<R | undefined> => {
    loadingMap.value[key] = true
    try {
      return await fn()
    } finally {
      loadingMap.value[key] = false
    }
  }

  /**
   * Wrap an async function with loading state management.
   * Returns both the result and any error that occurred.
   *
   * @param key - The operation key to track.
   * @param fn - The async function to execute.
   * @returns An object containing the data or error.
   */
  const withLoadingResult = async <R>(
    key: T,
    fn: () => Promise<R>
  ): Promise<LoadingResult<R>> => {
    loadingMap.value[key] = true
    try {
      const data = await fn()
      return { data }
    } catch (error) {
      return { error: error as Error }
    } finally {
      loadingMap.value[key] = false
    }
  }

  /**
   * Manually set loading state for an operation.
   * Useful when you need more control over the loading lifecycle.
   */
  const setLoading = (key: T, loading: boolean): void => {
    loadingMap.value[key] = loading
  }

  /**
   * Clear all loading states.
   */
  const clearAll = (): void => {
    loadingMap.value = {} as Record<T, boolean>
  }

  return {
    /** The raw loading map ref */
    loadingMap,
    /** Check if a specific operation is loading */
    isLoading,
    /** Whether any operation is loading */
    isAnyLoading,
    /** List of currently loading operation keys */
    loadingKeys,
    /** Execute an async function with loading tracking */
    withLoading,
    /** Execute an async function and return result with error */
    withLoadingResult,
    /** Manually set loading state */
    setLoading,
    /** Clear all loading states */
    clearAll,
  }
}
