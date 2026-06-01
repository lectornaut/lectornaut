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
 *   onError   → roll back + release the hold immediately.
 *   onSettled → release the hold after a short delay, letting the ack-driven
 *               snapshot land first; on release the cache reconciles to the
 *               latest server snapshot (Decision D — hold until the server ack).
 *
 * `mutationFn` is supplied by the caller and may be either `syncEngine.mutate`
 * (for outbox/command writes) or a Cloud Function callable (e.g. createWorkspace)
 * — the optimistic reconciliation is identical either way.
 */

import { queryClient } from "@/modules/queryClient"
import { withCloudSyncOperation } from "@/utils/firebase/firebase-optimistic"
import { holdOptimistic } from "@/utils/firebase/firebase-query"
import type { FirestoreQueryKey } from "@/utils/firebase/firebase-query-keys"
import { useMutation, type UseMutationReturnType } from "@tanstack/vue-query"

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
  /** Telemetry source tag for the cloud-sync queue (drives `SyncIndicator`). */
  source?: string
}

interface MutationContext {
  release: () => void
  rollback: () => void
}

const NOOP_CONTEXT: MutationContext = {
  release: () => {},
  rollback: () => {},
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
        source: options.source,
      }),
    onMutate: async (vars) => {
      const plan = options.optimistic?.(vars)
      if (!plan) return NOOP_CONTEXT

      // Stop any in-flight refetch from racing the optimistic write, then hold
      // each touched key against the live listener until the mutation settles.
      await Promise.all(
        plan.keys.map((key) => queryClient.cancelQueries({ queryKey: key }))
      )
      const releases = plan.keys.map((key) => holdOptimistic(key))
      plan.apply()

      return {
        release: () => releases.forEach((release) => release()),
        rollback: plan.rollback,
      }
    },
    onError: (_error, _vars, context) => {
      // Roll back immediately and lift the hold — there's no server write to
      // wait for.
      context?.rollback()
      context?.release()
    },
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
