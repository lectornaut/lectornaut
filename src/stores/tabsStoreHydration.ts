/**
 * Pure decision gates for the tabs store's hydration/persistence lifecycle,
 * extracted from `tabsStore.ts` so the matrix is unit-testable without the
 * store's Firebase/Pinia graph.
 *
 * The invariant they encode: a whole-doc tabs write may only follow a
 * SUCCESSFUL read of the same doc. TanStack ends a terminal read error with
 * `isLoading === false` and `data === undefined` — treating "no longer
 * pending" as "hydrated" would leave the local strip empty after a read
 * failure and let the next persist replace the user's saved tabs wholesale,
 * cross-device.
 */

export interface TabsReadState {
  /** A tabs doc ref exists (user/team/workspace all resolved). */
  hasRef: boolean
  /** The doc's data landed (query `data` is the parsed document). */
  hasData: boolean
  /** The listener confirmed the doc does not exist (query `data === null`). */
  confirmedAbsent: boolean
  /** The read failed terminally (TanStack error state). */
  isError: boolean
  /** Still waiting on the first snapshot. */
  isPending: boolean
}

/**
 * Hydrated only on a successful read: the doc's data landed, or the listener
 * confirmed the doc absent. A read error never hydrates — `data` can even be
 * stale-but-present when a refetch fails, so the error flag wins outright.
 */
export const shouldMarkHydrated = (state: TabsReadState): boolean =>
  state.hasRef &&
  !state.isError &&
  !state.isPending &&
  (state.hasData || state.confirmedAbsent)

export interface TabsPersistState {
  /** Path of the doc the write would target (null while the ref is unresolved). */
  targetPath: string | null
  /**
   * Path of the last successful read this session (null before one lands).
   * Comparing paths — not a boolean — keeps the gate airtight across ref
   * changes that don't pass through the workspace-switch watcher.
   */
  confirmedReadPath: string | null
}

/** A whole-doc persist may only target the exact doc a read has confirmed. */
export const canPersistTabs = (state: TabsPersistState): boolean =>
  state.targetPath !== null && state.targetPath === state.confirmedReadPath
