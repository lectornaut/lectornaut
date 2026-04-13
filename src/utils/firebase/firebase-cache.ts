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
 * Tries IndexedDB cache first (instant, works offline),
 * falls back to network on cache miss.
 */
export async function getDocCached<T>(
  ref: DocumentReference<T>
): Promise<DocumentSnapshot<T>> {
  try {
    const cached = await getDocFromCache(ref)
    if (cached.exists()) return cached
    return await getDoc(ref)
  } catch {
    return await getDoc(ref)
  }
}

/**
 * Cache-first collection/query read.
 * Tries IndexedDB cache first (instant, works offline),
 * falls back to network on cache miss.
 */
export async function getDocsCached<T>(q: Query<T>): Promise<QuerySnapshot<T>> {
  try {
    const cached = await getDocsFromCache(q)
    if (!cached.empty) return cached
    return await getDocs(q)
  } catch {
    return await getDocs(q)
  }
}
