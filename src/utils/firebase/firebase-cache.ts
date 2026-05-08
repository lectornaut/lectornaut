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
 * Tries the local IndexedDB cache first. If the cache has matching docs we
 * trust that result and skip the network — collections kept warm by an
 * `onSnapshot` listener consistently hit this path.
 *
 * Unlike `getDocFromCache`, `getDocsFromCache` does NOT throw when no
 * documents have been synced for the query — it simply resolves to an
 * empty snapshot, indistinguishable from a "truly empty" answer. So an
 * empty cached result is never authoritative on its own, and we fall
 * through to `getDocs` for the network's verdict. Same fallthrough on a
 * cache exception (e.g. persistence disabled).
 *
 * Net effect: this saves a round-trip only when the answer is non-empty
 * AND already local; otherwise it degrades to a plain `getDocs`. Callers
 * that always want freshness should use `getDocs` directly to skip the
 * cache probe entirely.
 */
export async function getDocsCached<T>(q: Query<T>): Promise<QuerySnapshot<T>> {
  try {
    const cached = await getDocsFromCache(q)
    if (!cached.empty) return cached
  } catch {
    // Cache miss or persistence error — fall through to the network.
  }
  return await getDocs(q)
}
