/**
 * Optimistic Firestore writes on top of TanStack Query.
 *
 * Wraps `useMutation` with the cache-based optimistic pattern, adapted for this
 * app's SERVER-APPLIED writes (a command round-trips through a Cloud Function /
 * the sync engine, so the live `onSnapshot` listener does NOT echo the write
 * locally and won't reflect it until the server applies it):
 *
 *   onMutate  → cancel in-flight refetches, snapshot for rollback, apply the
 *               optimistic value via `setQueryData`, and HOLD the touched keys
 *               so the live listener can't clobber them with a pre-apply
 *               snapshot (see `holdOptimistic`).
 *   onError   → roll back + release the hold immediately — unless the hold
 *               already timed out (`OPTIMISTIC_HOLD_TIMEOUT_MS`), in which case
 *               the pre-mutation snapshot is stale and the touched keys are
 *               INVALIDATED instead of rolled back (see `settleMutationError`).
 *   onSettled → release the hold after a short delay, letting the ack-driven
 *               snapshot land first; on release the cache reconciles to the
 *               latest server snapshot (Decision D — hold until the server ack).
 *               A hold that timed out first makes this release a no-op.
 *
 * `mutationFn` is supplied by the caller and may be either `syncEngine.mutate`
 * (for outbox/command writes) or a Cloud Function callable (e.g. createWorkspace)
 * — the optimistic reconciliation is identical either way.
 */

import { queryClient } from "@/modules/queryClient"
import {
  addPending,
  removePending,
  withCloudSyncOperation,
} from "@/utils/firebase/firebase-optimistic"
import { acquireOptimisticHold } from "@/utils/firebase/firebase-query"
import type { FirestoreQueryKey } from "@/utils/firebase/firebase-query-keys"
import { useMutation, type UseMutationReturnType } from "@tanstack/vue-query"
import type { Ref } from "vue"

/**
 * Brief hold after a mutation settles before releasing, so the server's
 * ack-driven snapshot lands and reconciles the cache before the optimistic hold
 * lifts. Mirrors the prior optimistic layer's `pendingReleaseDelayMs` default.
 */
const DEFAULT_SETTLE_DELAY_MS = 120

export interface OptimisticPlan {
  /** Cache keys this mutation optimistically touches (held vs. the listener). */
  keys: FirestoreQueryKey[]
  /** Apply the optimistic change(s) to the cache (typically `setQueryData`). */
  apply: () => void
  /** Revert the optimistic change(s); run on error. */
  rollback: () => void
}

export interface FirestoreMutationOptions<TVars, TData> {
  /** The actual write — `syncEngine.mutate(...)` or a Cloud Function callable. */
  mutationFn: (vars: TVars) => Promise<TData>
  /** Build the optimistic plan for `vars` (runs in onMutate). Omit for no optimism. */
  optimistic?: (vars: TVars) => OptimisticPlan
  /** Delay before releasing the optimistic hold after settle (default 120ms). */
  settleDelayMs?: number
  /**
   * Telemetry source tag for the cloud-sync queue (drives `SyncIndicator`).
   * A function resolves the tag from the mutation vars, so one mutation instance
   * can carry a per-call source (used by `useRunWrite`).
   */
  source?: string | ((vars: TVars) => string | undefined)
}

/** @internal exported only for unit tests (see `settleMutationError`). */
export interface MutationContext {
  release: () => void
  rollback: () => void
  /** True once ANY of the mutation's holds self-released on timeout. */
  holdExpired: () => boolean
  /**
   * Invalidate the plan's keys — the expired-hold replacement for rollback
   * (forces a refetch / listener re-attach that restores server truth).
   */
  invalidate: () => void
}

const NOOP_CONTEXT: MutationContext = {
  release: () => {},
  rollback: () => {},
  holdExpired: () => false,
  invalidate: () => {},
}

/**
 * Error settlement for an optimistic mutation. Ordering matters on the normal
 * path: roll back FIRST (restore the pre-mutation snapshot), THEN release the
 * hold — the release runs the stashed reconciler, folding the latest server
 * snapshot over the rolled-back value (whole-value replace for doc/collection
 * reads; head-only merge for infinite reads, so a rolled-back tail survives).
 *
 * EXCEPT when a hold already expired (`OPTIMISTIC_HOLD_TIMEOUT_MS`): the hold
 * lifted long ago, so the pre-mutation snapshot is stale — running
 * `rollback()` now could clobber newer server truth the listener delivered
 * since. But the expiry does NOT guarantee any re-delivery happened: a parked
 * OFFLINE write may have produced no emission at all, leaving the phantom
 * optimistic value in the cache — and a rejected write never changed the
 * server doc, so no correcting snapshot will ever arrive on its own. Instead
 * of a stale rollback OR a silent skip, INVALIDATE the plan's keys: the
 * refetch / listener re-attach restores server truth in both cases. Key-less
 * plans (store-local optimism) have no holds to expire, so their rollback
 * always runs. `release()` stays safe to call because every hold release is
 * idempotent (a no-op after its timeout).
 *
 * @internal exported only for unit tests.
 */
export const settleMutationError = (
  context: MutationContext | undefined
): void => {
  if (!context) return
  if (context.holdExpired()) {
    context.invalidate()
  } else {
    context.rollback()
  }
  context.release()
}

export function useFirestoreMutation<TVars, TData = void>(
  options: FirestoreMutationOptions<TVars, TData>
): UseMutationReturnType<TData, Error, TVars, MutationContext> {
  const settleDelayMs = options.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS

  return useMutation<TData, Error, TVars, MutationContext>({
    // Wrap in the cloud-sync telemetry so in-flight writes still surface in
    // `SyncIndicator` (the read-only queue metrics in firebase-optimistic are
    // kept; only its optimistic-apply/merge layer is being retired).
    mutationFn: (vars) =>
      withCloudSyncOperation(() => options.mutationFn(vars), {
        source:
          typeof options.source === "function"
            ? options.source(vars)
            : options.source,
      }),
    onMutate: async (vars) => {
      const plan = options.optimistic?.(vars)
      if (!plan) return NOOP_CONTEXT

      // Stop any in-flight refetch from racing the optimistic write, then hold
      // each touched key against the live listener until the mutation settles
      // (or the holds' own timeout lifts them first — see `settleMutationError`).
      await Promise.all(
        plan.keys.map((key) => queryClient.cancelQueries({ queryKey: key }))
      )
      const holds = plan.keys.map((key) => acquireOptimisticHold(key))
      plan.apply()

      return {
        release: () => holds.forEach((hold) => hold.release()),
        rollback: plan.rollback,
        holdExpired: () => holds.some((hold) => hold.expired()),
        invalidate: () => {
          for (const key of plan.keys) {
            void queryClient.invalidateQueries({ queryKey: key })
          }
        },
      }
    },
    onError: (_error, _vars, context) => settleMutationError(context),
    onSettled: (_data, _error, _vars, context) => {
      if (!context) return
      // Release after a beat so the ack-driven snapshot reconciles the cache to
      // server truth (stashed during the hold) before the hold lifts.
      if (settleDelayMs > 0) {
        setTimeout(context.release, settleDelayMs)
      } else {
        context.release()
      }
    },
  })
}

// ============================================================================
// The one optimistic-write interface (candidate 6)
// ============================================================================

/**
 * Brief hold after a write settles before its per-ID pending entry is released,
 * matching the optimistic layer's snapshot-lag buffer so per-row spinners don't
 * flicker between optimistic and server state. Mirrors `DEFAULT_SETTLE_DELAY_MS`.
 */
const PENDING_RELEASE_DELAY_MS = 120

/** Vars threaded through the shared `runWrite` mutation. */
interface RunWriteVars {
  keys: FirestoreQueryKey[]
  apply: () => void
  rollback: () => void
  fn: () => Promise<void>
  /** Per-call telemetry source override (falls back to the `useRunWrite` tag). */
  source?: string
}

export interface RunWriteOptions extends RunWriteVars {
  /**
   * Optional per-ID UI pending tracking. The ids are added to `ref` before the
   * write and released `PENDING_RELEASE_DELAY_MS` after it settles, so
   * `isXPending(id)` computeds stay truthful for the row's whole round-trip.
   * (The cache hold against the live listener is separate — it is driven by
   * `keys` inside `useFirestoreMutation`. Pass `keys: []` for optimism that
   * targets store-local/overlay state with no live listener to hold against.)
   */
  pending?: { ref: Ref<Set<string>>; ids: string[] }
}

/**
 * The single optimistic-write seam. Each store calls this once at setup and
 * gets back a `runWrite` that collapses the per-store `useFirestoreMutation` +
 * `runXMutation` wrapper + `addPending`/`removePending` dance into one call:
 *
 *   const runWrite = useRunWrite("team")
 *   await runWrite({ keys, apply, rollback, fn, pending: { ref, ids } })
 *
 * `apply`/`rollback` mutate the TanStack cache (and any derived store state);
 * `keys` are held against the live listener until the server-applied write
 * reconciles; `fn` performs the actual write (a Cloud Function callable or
 * `syncEngine.mutate`).
 */
export function useRunWrite(
  source: string
): (options: RunWriteOptions) => Promise<void> {
  const mutation = useFirestoreMutation<RunWriteVars, void>({
    mutationFn: (vars) => vars.fn(),
    optimistic: (vars) => ({
      keys: vars.keys,
      apply: vars.apply,
      rollback: vars.rollback,
    }),
    source: (vars) => vars.source ?? source,
  })

  return async ({ keys, apply, rollback, fn, pending, source: callSource }) => {
    if (pending) {
      for (const id of pending.ids) addPending(pending.ref, id)
    }
    try {
      await mutation.mutateAsync({
        keys,
        apply,
        rollback,
        fn,
        source: callSource,
      })
    } finally {
      if (pending) {
        const { ref, ids } = pending
        setTimeout(() => {
          for (const id of ids) removePending(ref, id)
        }, PENDING_RELEASE_DELAY_MS)
      }
    }
  }
}
