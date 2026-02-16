import { withToast, type WithToastOptions } from "@/helpers/toast"

type LoadingExecutor<T extends string> = <R>(
  key: T,
  fn: () => Promise<R>
) => Promise<R | undefined>

/**
 * Small orchestrator for async UI actions that need both loading state
 * tracking and toast feedback.
 */
export function createActionRunner<T extends string>(
  withLoading: LoadingExecutor<T>
) {
  const run = <R>(
    key: T,
    operation: () => Promise<R>,
    toast: WithToastOptions
  ): Promise<R | undefined> =>
    withLoading(key, () => withToast(operation, toast))

  return {
    run,
  }
}
