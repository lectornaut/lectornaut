/**
 * Query-key factory for the TanStack Query cache.
 *
 * Firestore document/collection *paths* are globally unique and stable, so they
 * make natural cache keys — `teams/abc/workspaces/xyz` identifies exactly one
 * document and reads legibly in the Query Devtools. List queries on the same
 * collection differ only by their constraints (`where`/`orderBy`), so callers
 * pass a `params` object to disambiguate them (e.g. shared vs. owned bot
 * sessions on the same `botSessions` collection).
 *
 * Keys are arrays per TanStack convention; the leading `"firestore"` namespace
 * keeps them from colliding with any non-Firestore queries added later, and
 * lets `queryClient.removeQueries({ queryKey: ["firestore"] })` target the whole
 * Firestore cache in one call (used by logout cleanup in a later step).
 *
 * Pass a `DocumentReference.path` / `CollectionReference.path` as `path` — it is
 * already the canonical, converter-independent identity of the location.
 */
export const queryKeys = {
  /** Key for a single document at `path` (typically `ref.path`). */
  doc: (path: string) => ["firestore", "doc", path] as const,

  /**
   * Key for a collection/query rooted at `path`, disambiguated by `params` —
   * the serialized form of its `where`/`orderBy` constraints. Omit `params`
   * for an unfiltered collection. TanStack hashes object keys deterministically,
   * so callers need not sort `params` themselves.
   */
  list: (path: string, params?: Record<string, unknown>) =>
    ["firestore", "list", path, params ?? null] as const,
} as const

/** Root key matching every Firestore-backed query (doc + list). */
export const FIRESTORE_QUERY_ROOT = ["firestore"] as const

export type FirestoreDocKey = ReturnType<typeof queryKeys.doc>
export type FirestoreListKey = ReturnType<typeof queryKeys.list>
export type FirestoreQueryKey = FirestoreDocKey | FirestoreListKey
