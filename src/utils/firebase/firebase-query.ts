/**
 * Realtime Firestore reads on top of TanStack Query.
 *
 * Firestore is push-based, so we do NOT poll in `queryFn`. Instead each query
 * opens an `onSnapshot` listener that:
 *   1. resolves the `queryFn` Promise on the FIRST snapshot (initial hydration),
 *   2. stays alive and pushes every later snapshot into the cache via
 *      `setQueryData` — that is what keeps the cached data "fresh" (hence
 *      `staleTime: Infinity` on the client; a timed refetch would be pointless).
 *
 * Listener lifetime is tied to the query's garbage collection: once a query has
 * had zero observers for `gcTime`, the QueryCache emits a `removed` event and we
 * tear the listener down. This is the ref-counted subscription manager the
 * migration calls for, delegated to TanStack's own observer/gc accounting
 * (keyed by the canonical `hashKey`) rather than a parallel hand-rolled counter.
 *
 * These composables replace the VueFire `useDocument`/`useCollection` bindings
 * one entity at a time. They accept refs/queries already wired through the Zod
 * converters in `firebase-helpers.ts`, so validation on read is preserved.
 */

import { queryClient } from "@/modules/queryClient"
import {
  queryKeys,
  type FirestoreQueryKey,
} from "@/utils/firebase/firebase-query-keys"
import { hashKey, useQuery, type UseQueryReturnType } from "@tanstack/vue-query"
import {
  onSnapshot,
  type DocumentReference,
  type FirestoreError,
  type Query,
  type Unsubscribe,
} from "firebase/firestore"
import { computed, toValue, type MaybeRefOrGetter } from "vue"

// ============================================================================
// Live listener registry (ref-counting via the query cache)
// ============================================================================

/**
 * Live `onSnapshot` unsubscribers, keyed by the query's canonical hash (the
 * same `hashKey(queryKey)` TanStack uses internally). At most one Firestore
 * listener exists per distinct key no matter how many components observe it.
 */
const liveListeners = new Map<string, Unsubscribe>()

const teardownListener = (queryHash: string): void => {
  const unsubscribe = liveListeners.get(queryHash)
  if (!unsubscribe) return
  liveListeners.delete(queryHash)
  unsubscribe()
}

// ============================================================================
// Optimistic write reconciliation
// ============================================================================

/**
 * Query hashes whose cached value is currently held by an in-flight optimistic
 * mutation, with a hold count (one key may be touched by several mutations).
 * While held, the live listener must NOT overwrite the optimistic value with an
 * interim server snapshot: writes here are SERVER-APPLIED (a command round-trips
 * through a Cloud Function), so a snapshot arriving before the server applies
 * the write still carries the OLD data and would clobber the optimistic update.
 */
const optimisticHolds = new Map<string, number>()
/** Latest snapshot received while a key was held, applied on final release. */
const stashedSnapshots = new Map<string, unknown>()

/**
 * Hold a query's cached value against live-listener overwrites until the
 * returned release fn runs (wire it to `useMutation`'s onError/onSettled). On
 * the final release the latest stashed server snapshot is applied, reconciling
 * the cache to server truth — e.g. an optimistic temp row is replaced by the
 * real row the server created. The release fn is idempotent and ref-counted.
 */
export function holdOptimistic(queryKey: FirestoreQueryKey): () => void {
  const queryHash = hashKey(queryKey)
  optimisticHolds.set(queryHash, (optimisticHolds.get(queryHash) ?? 0) + 1)

  let released = false
  return () => {
    if (released) return
    released = true
    const remaining = (optimisticHolds.get(queryHash) ?? 1) - 1
    if (remaining > 0) {
      optimisticHolds.set(queryHash, remaining)
      return
    }
    optimisticHolds.delete(queryHash)
    if (stashedSnapshots.has(queryHash)) {
      const data = stashedSnapshots.get(queryHash)
      stashedSnapshots.delete(queryHash)
      queryClient.setQueryData(queryKey, data)
    }
  }
}

/**
 * Install the single QueryCache subscription that tears a Firestore listener
 * down when its query is garbage-collected (zero observers for `gcTime`).
 * Idempotent — installed lazily on first use.
 */
let gcTeardownInstalled = false
const ensureGcTeardown = (): void => {
  if (gcTeardownInstalled) return
  gcTeardownInstalled = true
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "removed") {
      teardownListener(event.query.queryHash)
    }
  })
}

/**
 * Shared `queryFn` body for both document and collection reads. Opens a
 * listener via `open`, resolves on the first snapshot, then streams later
 * snapshots into the cache. `open` receives `onNext`/`onError` and returns the
 * Firestore `Unsubscribe`, so this stays free of any document-vs-collection
 * specifics (and trivially testable with a fake `open`).
 *
 * @internal exported only for unit tests; not part of the public read API.
 */
export const streamIntoCache = <T>(
  queryKey: FirestoreQueryKey,
  open: (
    onNext: (data: T) => void,
    onError: (error: FirestoreError) => void
  ) => Unsubscribe
): Promise<T> => {
  ensureGcTeardown()
  const queryHash = hashKey(queryKey)
  // A re-run of queryFn (remount after gc, or a key change) must not leak a
  // prior listener registered under the same hash.
  teardownListener(queryHash)

  return new Promise<T>((resolve, reject) => {
    let hydrated = false
    const unsubscribe = open(
      (data) => {
        if (hydrated) {
          if (optimisticHolds.has(queryHash)) {
            // An optimistic mutation is holding this key — stash the latest
            // server snapshot and reconcile on release instead of clobbering
            // the optimistic value with pre-server-apply data.
            stashedSnapshots.set(queryHash, data)
            return
          }
          // Later snapshot — push into the cache; observers react.
          queryClient.setQueryData<T>(queryKey, data)
          return
        }
        hydrated = true
        resolve(data)
      },
      (error) => {
        teardownListener(queryHash)
        if (hydrated) {
          // Post-hydration failure (e.g. permission revoked mid-session). Evict
          // the query so a future observer re-subscribes cleanly rather than
          // silently serving stale data behind a dead listener. Also drop any
          // optimistic hold + stashed snapshot for this key: otherwise a later
          // `holdOptimistic` release would `setQueryData` the stash back and
          // resurrect the query we just evicted, behind this now-dead listener.
          optimisticHolds.delete(queryHash)
          stashedSnapshots.delete(queryHash)
          queryClient.removeQueries({ queryKey, exact: true })
          return
        }
        // Pre-hydration failure surfaces as the query's error (the retry
        // classifier in queryClient.ts decides whether to retry).
        reject(error)
      }
    )
    liveListeners.set(queryHash, unsubscribe)
  })
}

// ============================================================================
// Public composables
// ============================================================================

export interface UseFirestoreQueryOptions {
  /**
   * Disable the query without changing the source. When it resolves false, no
   * listener is opened and `data` stays `undefined`. A null/undefined source
   * disables the query automatically (e.g. a ref that needs a not-yet-resolved
   * team id), so this is for additional gating on top of that.
   */
  enabled?: MaybeRefOrGetter<boolean>
}

/**
 * Realtime single-document read. Pass a (optionally reactive) converter-wired
 * `DocumentReference`, or null/undefined to keep the query idle until the ref
 * resolves.
 *
 * `data` is `T | null | undefined`, preserving the VueFire distinction several
 * stores depend on:
 *   - `undefined` — still loading (no snapshot yet);
 *   - `null` — the listener confirmed the document does not exist;
 *   - `T` — the document's (converter-parsed) data.
 * Stores use `=== undefined` to skip the loading window and `=== null` to fire
 * stale-id cleanup, so collapsing the two would break that logic.
 */
export function useDocumentQuery<T>(
  source: MaybeRefOrGetter<DocumentReference<T> | null | undefined>,
  options: UseFirestoreQueryOptions = {}
): UseQueryReturnType<T | null, FirestoreError> {
  const docRef = computed(() => toValue(source) ?? null)
  const enabled = computed(
    () => docRef.value !== null && toValue(options.enabled ?? true)
  )
  const queryKey = computed<FirestoreQueryKey>(() =>
    docRef.value ? queryKeys.doc(docRef.value.path) : queryKeys.doc("__idle__")
  )

  return useQuery<T | null, FirestoreError>({
    queryKey,
    enabled,
    queryFn: () => {
      const ref = docRef.value
      if (!ref) {
        // `enabled` guards this; the throw is only to satisfy the type narrowing.
        throw new Error("useDocumentQuery: queryFn ran without a document ref")
      }
      return streamIntoCache<T | null>(
        queryKeys.doc(ref.path),
        (onNext, onError) =>
          onSnapshot(
            ref,
            // `null` (not `undefined`) for a missing doc, so callers can tell a
            // confirmed-absent document apart from the still-loading state.
            (snapshot) => onNext(snapshot.exists() ? snapshot.data() : null),
            onError
          )
      )
    },
  })
}

export interface CollectionQuerySource {
  /**
   * The (constraint-applied) Firestore query to listen to. Typed loosely as
   * `Query<unknown>` so any query is accepted regardless of its converter's
   * output type; the caller asserts the row shape via the composable's `<T>`,
   * mirroring VueFire's `useCollection<T>` contract. (E.g. the memberships
   * collectionGroup whose converter yields `IMembershipDocData` is read as the
   * richer joined `IMembership`, and the unconverted `invitations` collection
   * is read as `IInvitation`.) Where a Zod converter is wired it still validates
   * on read; this only relaxes the compile-time row type, exactly as before.
   */
  query: Query<unknown>
  /** Collection path — the stable portion of the cache key. */
  path: string
  /**
   * Disambiguator for the query's constraints (where/orderBy), folded into the
   * cache key so two different queries on the same collection (e.g. owned vs.
   * shared) get distinct cache entries.
   */
  params?: Record<string, unknown>
}

/**
 * Realtime collection/query read. The source getter returns the query plus its
 * cache identity (`path` + `params`), or null/undefined to stay idle. `data` is
 * `T[] | undefined` — undefined before the first snapshot; callers typically
 * coalesce with `?? []` to mirror VueFire's empty-array default.
 */
export function useCollectionQuery<T>(
  source: MaybeRefOrGetter<CollectionQuerySource | null | undefined>,
  options: UseFirestoreQueryOptions = {}
): UseQueryReturnType<T[], FirestoreError> {
  const resolved = computed(() => toValue(source) ?? null)
  const enabled = computed(
    () => resolved.value !== null && toValue(options.enabled ?? true)
  )
  const queryKey = computed<FirestoreQueryKey>(() =>
    resolved.value
      ? queryKeys.list(resolved.value.path, resolved.value.params)
      : queryKeys.list("__idle__")
  )

  return useQuery<T[], FirestoreError>({
    queryKey,
    enabled,
    queryFn: () => {
      const current = resolved.value
      if (!current) {
        throw new Error(
          "useCollectionQuery: queryFn ran without a query source"
        )
      }
      return streamIntoCache<T[]>(
        queryKeys.list(current.path, current.params),
        (onNext, onError) =>
          onSnapshot(
            current.query,
            (snapshot) =>
              // Drop nullish converter rows so a `T[]` never contains `null` —
              // some converters return `null` for tombstoned/invalid docs.
              // Callers historically filtered downstream; enforce it here so the
              // primitive's `T[]` contract holds for every consumer.
              onNext(
                snapshot.docs
                  .map((entry) => entry.data())
                  .filter((row): row is T => row != null)
              ),
            onError
          )
      )
    },
  })
}
