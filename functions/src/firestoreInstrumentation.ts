/**
 * Firestore Operation Instrumentation
 *
 * Lightweight wrapper that counts reads/writes/deletes per request.
 * Does NOT intercept or proxy the Firestore client — instead provides
 * simple counter functions to be called explicitly at key points.
 *
 * Usage:
 *   const tracker = createFirestoreTracker()
 *   tracker.trackRead(1)
 *   tracker.trackQuery({ collection: "memberships", limit: 10, whereCount: 2 })
 *   tracker.trackWrite(3)
 *   console.log(tracker.summary())  // { reads: 1, queries: 1, writes: 3, deletes: 0 }
 */

export interface QueryCharacteristics {
  collection: string
  isCollectionGroup?: boolean
  limit?: number | null
  whereCount?: number
  orderByCount?: number
  hasSelect?: boolean
}

export interface FirestoreTracker {
  trackRead(count?: number): void
  trackWrite(count?: number): void
  trackDelete(count?: number): void
  trackQuery(characteristics: QueryCharacteristics): void
  summary(): FirestoreSummary
}

export interface FirestoreSummary {
  reads: number
  writes: number
  deletes: number
  queries: QueryCharacteristics[]
}

/**
 * Create a per-request Firestore operation tracker.
 * Call this at the start of each handler and pass it through.
 */
export function createFirestoreTracker(): FirestoreTracker {
  let reads = 0
  let writes = 0
  let deletes = 0
  const queries: QueryCharacteristics[] = []

  return {
    trackRead(count = 1) {
      reads += count
    },
    trackWrite(count = 1) {
      writes += count
    },
    trackDelete(count = 1) {
      deletes += count
    },
    trackQuery(characteristics) {
      queries.push(characteristics)
      // A query's read count is the number of results,
      // which we don't know here. The caller should also call trackRead.
    },
    summary() {
      return { reads, writes, deletes, queries: [...queries] }
    },
  }
}
