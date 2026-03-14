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
  const loadingCounts = ref<Record<string, number>>({}) as Ref<
    Record<T, number>
  >

  const loadingMap: ComputedRef<Record<T, boolean>> = computed(() => {
    const next = {} as Record<T, boolean>
    for (const key in loadingCounts.value) {
      if ((loadingCounts.value[key as T] ?? 0) > 0) {
        next[key as T] = true
      }
    }
    return next
  })

  const startLoading = (key: T): void => {
    loadingCounts.value[key] = (loadingCounts.value[key] ?? 0) + 1
  }

  const finishLoading = (key: T): void => {
    const currentCount = loadingCounts.value[key] ?? 0
    if (currentCount <= 1) {
      delete loadingCounts.value[key]
      return
    }
    loadingCounts.value[key] = currentCount - 1
  }

  /**
   * Check if a specific operation is loading.
   * @param key - The operation key to check.
   * @returns True if the operation is in progress.
   */
  const isLoading = (key: T): boolean => (loadingCounts.value[key] ?? 0) > 0

  /**
   * Computed ref that returns true if any operation is loading.
   */
  const isAnyLoading: ComputedRef<boolean> = computed(
    () => Object.keys(loadingCounts.value).length > 0
  )

  /**
   * Get all currently loading operation keys.
   */
  const loadingKeys: ComputedRef<T[]> = computed(
    () => Object.keys(loadingCounts.value) as T[]
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
    startLoading(key)
    try {
      return await fn()
    } finally {
      finishLoading(key)
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
    startLoading(key)
    try {
      const data = await fn()
      return { data }
    } catch (error) {
      return { error: error as Error }
    } finally {
      finishLoading(key)
    }
  }

  /**
   * Manually set loading state for an operation.
   * Useful when you need more control over the loading lifecycle.
   */
  const setLoading = (key: T, loading: boolean): void => {
    if (loading) {
      loadingCounts.value[key] = 1
      return
    }
    delete loadingCounts.value[key]
  }

  /**
   * Clear all loading states.
   */
  const clearAll = (): void => {
    loadingCounts.value = {} as Record<T, number>
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
