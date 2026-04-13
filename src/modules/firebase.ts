import { getAnalytics } from "firebase/analytics"
import { initializeApp } from "firebase/app"
import { browserLocalPersistence, getAuth, setPersistence } from "firebase/auth"
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore"
import { getFunctions } from "firebase/functions"
import { getStorage } from "firebase/storage"

// Silences the benign "Failed to obtain primary lease for action" log that
// Firestore's multi-tab persistence emits from secondary tabs. The SDK catches
// the underlying FAILED_PRECONDITION internally via `ignoreIfPrimaryLeaseLoss()`
// and transitions the tab to secondary mode — it never reaches app code. All
// other Firestore errors pass through untouched. Must run before any
// `firebase/firestore` SDK code executes.
const LEASE_LOG_PATTERN =
  /@firebase\/firestore:.*Failed to obtain primary lease for action '[^']*'\.?/
const originalConsoleError = console.error.bind(console)
console.error = (...data: unknown[]): void => {
  const first = data[0]
  if (typeof first === "string" && LEASE_LOG_PATTERN.test(first)) return
  originalConsoleError(...data)
}

/**
 * Firebase Configuration and Initialization
 *
 * Exports initialized Firebase services (Auth, Firestore, Analytics, Functions, Storage).
 *
 * -- Offline stack overview --
 *
 * L0 Native: `persistentLocalCache` below gives you IndexedDB reads, an
 *    automatic offline write queue, and multi-tab coordination for free.
 *    Under multi-tab, the SDK emits a benign "Failed to obtain primary lease"
 *    error log that the filter above silences at the source.
 *
 * On top of L0, four custom layers solve problems native persistence does not:
 *
 * L1 `firebase-cache.ts` (`getDocCached` / `getDocsCached`)
 *    Cache-first read — skips the network on cache hit. Use for DISPLAY reads
 *    where stale data is OK. DO NOT use for authorization, dedup, or
 *    precondition checks — use plain `getDoc`/`getDocs` instead.
 *
 * L2 `firebase-hydration.ts` (`useLocalHydration`)
 *    Synchronous localStorage hydration for store setup. Fills the cold-start
 *    gap before the async IndexedDB cache resolves. Call from Pinia store setup.
 *
 * L3 `firebase-optimistic.ts` (`withOptimisticUpdate`, pending-id sets)
 *    Pinia-aware optimistic updates with rollback, snapshot guards, retry/backoff.
 *
 * L4 `firebase-sync-engine.ts` + `firebase-mutation-coordinator.ts`
 *    (`mutateWithCoordinator`) — custom mutation outbox with per-op server
 *    ACKs, `baseVersion` optimistic locking, and observable queue metrics for
 *    `SyncIndicator.vue`. Use for ALL writes; do NOT call
 *    `setDoc`/`updateDoc`/`deleteDoc` directly from stores.
 */
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_DATABASE_URL,
  projectId: import.meta.env.VITE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_ID,
  measurementId: import.meta.env.VITE_MEASUREMENT_ID,
}

export const firebaseApp = initializeApp(firebaseConfig)
export const analytics = getAnalytics(firebaseApp)
export const firestore = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
})
export const auth = getAuth(firebaseApp)
export const functions = getFunctions(firebaseApp)
export const storage = getStorage(firebaseApp)

// Explicitly use LocalStorage so we can capture the session blob synchronously.
setPersistence(auth, browserLocalPersistence)
