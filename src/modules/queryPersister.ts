/**
 * Read-cache persistence for instant cold starts.
 *
 * Persists ONLY the TanStack Query read cache to localStorage (the write/outbox
 * durability is Firestore's `persistentLocalCache` — see `modules/firebase.ts`).
 * On boot we restore the cache so the UI paints last-session data immediately,
 * then the realtime listeners reconnect and reconcile.
 *
 * This replaces the cold-start role of `firebase-hydration.ts`'s
 * `useLocalHydration`, including its Firestore `Timestamp` revival: Timestamps
 * don't survive a JSON round-trip (they'd come back as plain
 * `{ seconds, nanoseconds }` objects, breaking `.toDate()` and sort
 * comparators), so we tag instances on the way out and revive them on the way
 * back in.
 */

import { queryClient } from "@/modules/queryClient"
import { FIRESTORE_QUERY_ROOT } from "@/utils/firebase/firebase-query-keys"
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
  type PersistedClient,
} from "@tanstack/query-persist-client-core"
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"
import type { Query } from "@tanstack/vue-query"
import { Timestamp } from "firebase/firestore"

const STORAGE_KEY = "lectornaut.query-cache.v1"
const MAX_AGE_MS = 1000 * 60 * 60 * 24 // 24h — drop anything older on restore.
// Bump to discard incompatible persisted caches after a cache-shape change.
const CACHE_BUSTER = "v1"

const TIMESTAMP_TAG = "__firestoreTimestamp__"

interface TaggedTimestamp {
  [TIMESTAMP_TAG]: { seconds: number; nanoseconds: number }
}

const isTaggedTimestamp = (value: object): value is TaggedTimestamp =>
  TIMESTAMP_TAG in value

/** Deep-replace Firestore `Timestamp` instances with a JSON-safe tagged form. */
export function tagTimestamps(value: unknown): unknown {
  if (value instanceof Timestamp) {
    return {
      [TIMESTAMP_TAG]: {
        seconds: value.seconds,
        nanoseconds: value.nanoseconds,
      },
    }
  }
  if (Array.isArray(value)) return value.map(tagTimestamps)
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      result[key] = tagTimestamps((value as Record<string, unknown>)[key])
    }
    return result
  }
  return value
}

/** Inverse of {@link tagTimestamps}: revive tagged forms into real Timestamps. */
export function reviveTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reviveTimestamps)
  if (value && typeof value === "object") {
    if (isTaggedTimestamp(value)) {
      const { seconds, nanoseconds } = value[TIMESTAMP_TAG]
      return new Timestamp(seconds, nanoseconds)
    }
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      result[key] = reviveTimestamps((value as Record<string, unknown>)[key])
    }
    return result
  }
  return value
}

const persister = createSyncStoragePersister({
  storage: typeof window !== "undefined" ? window.localStorage : undefined,
  key: STORAGE_KEY,
  serialize: (client) => JSON.stringify(tagTimestamps(client)),
  deserialize: (cached) =>
    reviveTimestamps(JSON.parse(cached)) as PersistedClient,
})

/**
 * Only persist our Firestore-backed queries that actually carry data — never
 * idle/disabled queries, and nothing outside the `"firestore"` namespace.
 */
const shouldDehydrateQuery = (query: Query): boolean =>
  query.state.status === "success" &&
  Array.isArray(query.queryKey) &&
  query.queryKey[0] === "firestore"

/**
 * Restore the persisted read cache, then mark the restored Firestore queries
 * stale. Under `staleTime: Infinity` a restored query looks fresh, so its
 * `queryFn` — which opens the `onSnapshot` listener — would never run and the
 * data would be frozen. `refetchType: "none"` flags them stale WITHOUT
 * refetching now (nothing is observed yet, pre-mount); the first observer then
 * reconnects the live listener, after which `staleTime: Infinity` keeps it
 * fresh again. Call once, before mounting the app.
 */
export async function restoreQueryCache(): Promise<void> {
  await persistQueryClientRestore({
    queryClient,
    persister,
    maxAge: MAX_AGE_MS,
    buster: CACHE_BUSTER,
  })
  await queryClient.invalidateQueries({
    queryKey: FIRESTORE_QUERY_ROOT,
    refetchType: "none",
  })
}

/** Begin persisting read-cache changes back to localStorage. Call once at boot. */
export function startQueryCachePersistence(): () => void {
  // `maxAge` is a restore-time concern (see restoreQueryCache); the save path
  // only needs the buster + dehydrate filter.
  return persistQueryClientSubscribe({
    queryClient,
    persister,
    buster: CACHE_BUSTER,
    dehydrateOptions: { shouldDehydrateQuery },
  })
}

/**
 * Drop the persisted read cache and clear the in-memory cache. Called on logout
 * so the next user never sees the previous user's data (the read-cache
 * counterpart to `clearHydrationCache`).
 */
export async function clearPersistedQueryCache(): Promise<void> {
  await persister.removeClient()
  queryClient.clear()
}
