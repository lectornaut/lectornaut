import {
  getDoc,
  getDocFromCache,
  getDocs,
  getDocsFromCache,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QuerySnapshot,
} from "firebase/firestore"

/**
 * Cache-first document read.
 *
 * Tries the Firestore IndexedDB cache first (instant, works offline). If the
 * cache has a definitive answer — either the doc's data or a tombstone for a
 * known-missing doc — we trust it and skip the network round-trip entirely.
 * Only a true cache miss (getDocFromCache throws) falls through to `getDoc`.
 *
 * This shaves a network round-trip off every lookup of a known-missing doc
 * (~100-500ms depending on latency). Callers that need server freshness
 * should use `getDoc` directly.
 */
export async function getDocCached<T>(
  ref: DocumentReference<T>
): Promise<DocumentSnapshot<T>> {
  try {
    return await getDocFromCache(ref)
  } catch {
    return await getDoc(ref)
  }
}

/**
 * Cache-first collection/query read.
 *
 * Mirrors `getDocCached`: if the cache answers the query (populated OR
 * definitively empty), we return that snapshot directly. A cache miss
 * (throws) falls through to the network. Callers needing fresh results
 * should use `getDocs` directly.
 *
 * Note: `cached.empty` alone is ambiguous — it could mean the cache knows
 * the query is empty, OR the cache simply has no entries for this query
 * shape. Firestore's `getDocsFromCache` distinguishes by throwing on the
 * latter, so we rely on the throw boundary rather than the `empty` flag.
 */
export async function getDocsCached<T>(q: Query<T>): Promise<QuerySnapshot<T>> {
  try {
    return await getDocsFromCache(q)
  } catch {
    return await getDocs(q)
  }
}
