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
  getDocs,
  onSnapshot,
  type DocumentReference,
  type FirestoreError,
  type Query,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore"
import {
  computed,
  ref,
  shallowRef,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
} from "vue"

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
/**
 * Reconciler to run against the cached value on a key's FINAL hold release. It
 * captured the latest server snapshot while the key was held; running it on
 * release folds that snapshot into whatever the cache holds at that point (the
 * optimistic value) WITHOUT clobbering the parts of the entry the live listener
 * doesn't own. Single-doc/collection reads register a whole-value replace
 * (`() => snapshot`); the infinite read registers a head-only merge
 * (`(cached) => ({ ...cached, head })`) so its append-only, listener-less tail
 * survives reconciliation. Keyed by query hash.
 */
const stashedReconcilers = new Map<string, (cached: unknown) => unknown>()

/**
 * Hold a query's cached value against live-listener overwrites until the
 * returned release fn runs (wire it to `useMutation`'s onError/onSettled). On
 * the final release the stashed reconciler runs, reconciling the cache to server
 * truth — e.g. an optimistic temp row is replaced by the real row the server
 * created. The release fn is idempotent and ref-counted.
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
    const reconcile = stashedReconcilers.get(queryHash)
    if (reconcile) {
      stashedReconcilers.delete(queryHash)
      queryClient.setQueryData(queryKey, (cached) => reconcile(cached))
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
 * Shared `queryFn` body for document, collection, AND infinite reads. Opens a
 * listener via `open`, resolves on the first snapshot, then folds later
 * snapshots into the cache via `reduce`. `open` receives `onNext`/`onError` and
 * returns the Firestore `Unsubscribe`, so this stays free of any
 * document-vs-collection-vs-infinite specifics (and trivially testable with a
 * fake `open`).
 *
 * `reduce(incoming, cached)` decides how a listener payload folds into the cached
 * value. The default REPLACES wholesale (`incoming` IS the new cache value) — the
 * single-doc and single-collection reads, where the listener owns the whole
 * entry. The infinite read passes a reducer that merges the incoming live first
 * page into the cached `{ head, tail }`, so the append-only `tail` (which has no
 * listener) survives every head refresh — and survives optimistic reconciliation,
 * because the held-key stash captures `reduce` and re-runs it against the
 * optimistic value on release.
 *
 * @internal exported only for unit tests; not part of the public read API.
 */
export const streamIntoCache = <T, V = T>(
  queryKey: FirestoreQueryKey,
  open: (
    onNext: (incoming: T) => void,
    onError: (error: FirestoreError) => void
  ) => Unsubscribe,
  reduce: (incoming: T, cached: V | undefined) => V = (incoming) =>
    incoming as unknown as V
): Promise<V> => {
  ensureGcTeardown()
  const queryHash = hashKey(queryKey)
  // A re-run of queryFn (remount after gc, or a key change) must not leak a
  // prior listener registered under the same hash.
  teardownListener(queryHash)

  return new Promise<V>((resolve, reject) => {
    let hydrated = false
    const unsubscribe = open(
      (incoming) => {
        if (hydrated) {
          if (optimisticHolds.has(queryHash)) {
            // An optimistic mutation is holding this key — stash a reconciler
            // that folds THIS snapshot into whatever the cache holds AT RELEASE
            // time (the optimistic value), instead of clobbering it now with
            // pre-server-apply data.
            stashedReconcilers.set(queryHash, (cached) =>
              reduce(incoming, cached as V | undefined)
            )
            return
          }
          // Later snapshot — fold into the cache; observers react.
          queryClient.setQueryData<V>(queryKey, (cached) =>
            reduce(incoming, cached)
          )
          return
        }
        hydrated = true
        resolve(reduce(incoming, undefined))
      },
      (error) => {
        teardownListener(queryHash)
        if (hydrated) {
          // Post-hydration failure (e.g. permission revoked mid-session). Evict
          // the query so a future observer re-subscribes cleanly rather than
          // silently serving stale data behind a dead listener. Also drop any
          // optimistic hold + stashed reconciler for this key: otherwise a later
          // `holdOptimistic` release would run the reconciler and resurrect the
          // query we just evicted, behind this now-dead listener.
          optimisticHolds.delete(queryHash)
          stashedReconcilers.delete(queryHash)
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

// ============================================================================
// Infinite read (live first page + cursor-paginated tail)
// ============================================================================

/**
 * Cache shape for an infinite collection: a live first page (`head`, replaced
 * wholesale by the listener on every snapshot) plus append-only older pages
 * (`tail`, grown by `loadMore`). Kept structured in the cache — rather than one
 * pre-merged array — so the listener can refresh `head` without losing `tail`,
 * and an optimistic write can patch a row in either tier. The merged, sorted,
 * de-duplicated view consumers render is derived by `mergeHeadTail`.
 */
export interface InfiniteCollectionData<T> {
  head: T[]
  tail: T[]
}

/**
 * Merge a live first page (`head`) with appended older pages (`tail`) into one
 * sorted, de-duplicated list. Head wins on id collisions: a row that crossed the
 * page boundary — a new arrival pushed it out of the live window into an
 * already-fetched older page — appears once, carrying its freshest copy.
 *
 * Pure and exported for unit tests; this is the structural merge that replaced
 * the retired seam-A collection-merge overlay. Optimism is no longer merged
 * here — it is applied directly to `head`/`tail` in the cache, so this needs no
 * pending-id arbitration.
 */
export function mergeHeadTail<T extends { id: string }>(
  head: readonly T[],
  tail: readonly T[],
  sort?: (a: T, b: T) => number
): T[] {
  const seen = new Set<string>()
  const merged: T[] = []
  for (const row of head) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    merged.push(row)
  }
  for (const row of tail) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    merged.push(row)
  }
  if (sort) merged.sort(sort)
  return merged
}

export interface InfiniteCollectionSource<T> {
  /** Collection path — the stable portion of the cache key. */
  path: string
  /** Rows per page (the live first page and each `loadMore`). */
  pageSize: number
  /**
   * Build the (constraint-applied) query for a page. `after` is null for the
   * live first page and the cursor doc for each older page.
   */
  buildQuery: (after: QueryDocumentSnapshot<unknown> | null) => Query<unknown>
  /** Map a snapshot doc to the row type (converter-independent). */
  toRow: (id: string, data: Record<string, unknown>) => T
  /** Sort for the merged `head ∪ tail` view. */
  sort?: (a: T, b: T) => number
  /** Disambiguator folded into the cache key (where/orderBy variants). */
  params?: Record<string, unknown>
}

export interface UseInfiniteCollectionQueryReturn<T> {
  /** Merged, sorted, de-duplicated rows (empty array before the first snapshot). */
  data: ComputedRef<T[]>
  isLoading: ComputedRef<boolean>
  isLoadingMore: Ref<boolean>
  hasMore: Ref<boolean>
  loadMore: () => Promise<void>
  /** The cache key — pass through `runWrite({ keys: [key.value] })`. */
  key: ComputedRef<FirestoreQueryKey>
  /** Current cache entry (or an empty one) — capture before an optimistic write. */
  snapshot: () => InfiniteCollectionData<T>
  /** Patch the cache entry — drive from `runWrite`'s `apply`/`rollback`. */
  update: (
    updater: (entry: InfiniteCollectionData<T>) => InfiniteCollectionData<T>
  ) => void
}

/**
 * Realtime infinite collection read: a live `onSnapshot` over the first page
 * (new arrivals appear automatically) plus cursor-paginated older pages fetched
 * on demand via `loadMore` (`getDocs`, static history). Both tiers live in ONE
 * ref-counted cache entry, so optimism flows through the same `runWrite({ keys })`
 * hold every other store uses: `apply`/`rollback` patch the `{ head, tail }`
 * entry via `update`, and the listener's interim snapshots are stashed (head-only)
 * and reconciled on release.
 *
 * The cursor and `hasMore`/`isLoadingMore` flags are composable-local — a
 * `QueryDocumentSnapshot` must never enter the deep-reactive cache, it breaks
 * `startAfter` (assertion 0xb815) — and reset whenever the source identity
 * changes (e.g. user switch). The listener owns the cursor only while no older
 * pages are loaded; once `loadMore` advances past page 1 it owns its own cursor.
 */
export function useInfiniteCollectionQuery<T extends { id: string }>(
  source: MaybeRefOrGetter<InfiniteCollectionSource<T> | null | undefined>,
  options: UseFirestoreQueryOptions = {}
): UseInfiniteCollectionQueryReturn<T> {
  const resolved = computed(() => toValue(source) ?? null)
  const enabled = computed(
    () => resolved.value !== null && toValue(options.enabled ?? true)
  )
  const queryKey = computed<FirestoreQueryKey>(() =>
    resolved.value
      ? queryKeys.list(resolved.value.path, resolved.value.params)
      : queryKeys.list("__idle__")
  )

  const cursor = shallowRef<QueryDocumentSnapshot<unknown> | null>(null)
  const hasMore = ref(true)
  const isLoadingMore = ref(false)

  // Reset pagination when the source identity changes (user switch / sign-out);
  // TanStack garbage-collects the old cache entry and tears its listener down.
  watch(
    () =>
      resolved.value
        ? `${resolved.value.path}|${JSON.stringify(resolved.value.params ?? null)}`
        : null,
    () => {
      cursor.value = null
      hasMore.value = true
      isLoadingMore.value = false
    }
  )

  const query = useQuery<InfiniteCollectionData<T>, FirestoreError>({
    queryKey,
    enabled,
    queryFn: () => {
      const current = resolved.value
      if (!current) {
        throw new Error(
          "useInfiniteCollectionQuery: queryFn ran without a source"
        )
      }
      const key = queryKeys.list(current.path, current.params)
      return streamIntoCache<T[], InfiniteCollectionData<T>>(
        key,
        (onNext, onError) =>
          onSnapshot(
            current.buildQuery(null),
            (snap) => {
              const head = snap.docs.map((entry) =>
                current.toRow(entry.id, entry.data() as Record<string, unknown>)
              )
              // The live listener owns the cursor/hasMore ONLY while no older
              // pages are loaded — once `loadMore` advances past page 1, its
              // cursor is further along and a live emission must not rewind it.
              const tailEmpty =
                (queryClient.getQueryData<InfiniteCollectionData<T>>(key)?.tail
                  .length ?? 0) === 0
              if (tailEmpty) {
                if (snap.size === current.pageSize) {
                  cursor.value = snap.docs[snap.size - 1] ?? null
                  hasMore.value = true
                } else {
                  cursor.value = null
                  hasMore.value = false
                }
              }
              onNext(head)
            },
            onError
          ),
        (head, cached) => ({ head, tail: cached?.tail ?? [] })
      )
    },
  })

  const data = computed<T[]>(() => {
    const entry = query.data.value
    if (!entry) return []
    return mergeHeadTail(entry.head, entry.tail, resolved.value?.sort)
  })

  const snapshot = (): InfiniteCollectionData<T> =>
    queryClient.getQueryData<InfiniteCollectionData<T>>(queryKey.value) ?? {
      head: [],
      tail: [],
    }

  const update = (
    updater: (entry: InfiniteCollectionData<T>) => InfiniteCollectionData<T>
  ): void => {
    queryClient.setQueryData<InfiniteCollectionData<T>>(
      queryKey.value,
      (prev) => updater(prev ?? { head: [], tail: [] })
    )
  }

  const loadMore = async (): Promise<void> => {
    const current = resolved.value
    if (!current) return
    if (isLoadingMore.value) return
    if (!hasMore.value) return
    const after = cursor.value
    if (!after) return

    isLoadingMore.value = true
    try {
      const snap = await getDocs(current.buildQuery(after))
      const next = snap.docs.map((entry) =>
        current.toRow(entry.id, entry.data() as Record<string, unknown>)
      )
      update((entry) => ({ head: entry.head, tail: [...entry.tail, ...next] }))
      if (snap.size < current.pageSize) {
        hasMore.value = false
        cursor.value = null
      } else {
        cursor.value = snap.docs[snap.size - 1] ?? null
      }
    } catch (error) {
      // Don't latch hasMore=false on a transient error — let the user retry.
      console.error("useInfiniteCollectionQuery: loadMore failed", error)
    } finally {
      isLoadingMore.value = false
    }
  }

  return {
    data,
    isLoading: computed(() => query.isLoading.value),
    isLoadingMore,
    hasMore,
    loadMore,
    key: queryKey,
    snapshot,
    update,
  }
}
