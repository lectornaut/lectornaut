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
 * back in. JS `Date`s get the same treatment: rows whose `toRow` converts to
 * `Date` (e.g. notifications `createdAt`) would otherwise be reduced to `{}`
 * by the deep clone and crash sort comparators on the restored entry.
 */

import { queryClient } from "@/modules/queryClient"
import { FIRESTORE_QUERY_ROOT } from "@/utils/firebase/firebase-query-keys"
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
  type PersistedClient,
} from "@tanstack/query-persist-client-core"
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"
import { dehydrate } from "@tanstack/vue-query"
import { Timestamp } from "firebase/firestore"

const STORAGE_KEY = "lectornaut.query-cache.v1"
const MAX_AGE_MS = 1000 * 60 * 60 * 24 // 24h — drop anything older on restore.
// Bump to discard incompatible persisted caches after a cache-shape change.
// v2: Dates are tagged; v1 blobs hold `{}` where rows had `Date` fields.
const CACHE_BUSTER = "v2"

/**
 * Throttle window for the subscribe-driven save path. Every save deep-clones
 * (`tagTimestamps`) and stringifies the ENTIRE dehydrated cache, so the
 * library's 1s default meant a full-cache serialize roughly every second while
 * snapshots stream. 5s keeps the persisted copy fresh enough for a cold-start
 * paint while cutting that work ~5x; the visibilitychange/pagehide flush below
 * covers the "user left mid-window" gap (the sync persister's trailing throttle
 * timer never fires once the page is gone).
 */
const PERSIST_THROTTLE_MS = 5_000

/**
 * Row-count ceiling for a persisted list/infinite entry. The blob is one
 * localStorage value serialized wholesale per save, so a single
 * heavily-paginated feed (e.g. a notifications tail grown by `loadMore`) can
 * come to dominate both the serialize cost and the boot-blocking restore
 * parse. Live pages are 20–50 rows, so 200 keeps several full pages of every
 * normal working set (file tree, sessions, memberships) while skipping
 * unbounded history — a skipped entry simply refetches live on boot, exactly
 * like a cache miss.
 *
 * @internal exported only for unit tests.
 */
export const MAX_PERSISTED_LIST_ROWS = 200

const TIMESTAMP_TAG = "__firestoreTimestamp__"
const DATE_TAG = "__jsDate__"

interface TaggedTimestamp {
  [TIMESTAMP_TAG]: { seconds: number; nanoseconds: number }
}

interface TaggedDate {
  [DATE_TAG]: number
}

const isTaggedTimestamp = (value: object): value is TaggedTimestamp =>
  TIMESTAMP_TAG in value

const isTaggedDate = (value: object): value is TaggedDate => DATE_TAG in value

/** Deep-replace `Timestamp`/`Date` instances with a JSON-safe tagged form. */
export function tagTimestamps(value: unknown): unknown {
  if (value instanceof Timestamp) {
    return {
      [TIMESTAMP_TAG]: {
        seconds: value.seconds,
        nanoseconds: value.nanoseconds,
      },
    }
  }
  if (value instanceof Date) {
    return { [DATE_TAG]: value.getTime() }
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
    if (isTaggedDate(value)) return new Date(value[DATE_TAG])
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
  throttleTime: PERSIST_THROTTLE_MS,
  serialize: (client) => JSON.stringify(tagTimestamps(client)),
  deserialize: (cached) =>
    reviveTimestamps(JSON.parse(cached)) as PersistedClient,
})

/** Structural slice of a TanStack `Query` the dehydrate filter reads. */
interface DehydrateCandidate {
  queryKey: readonly unknown[]
  state: { status: string; data: unknown }
}

/**
 * Row count of a persistable entry, when it has one: `T[]` for collection
 * lists, `{ head, tail }` for infinite reads (see `InfiniteCollectionData`).
 * `null` for single docs and any other shape — no row dimension to cap.
 */
const entryRowCount = (data: unknown): number | null => {
  if (Array.isArray(data)) return data.length
  if (data && typeof data === "object") {
    const { head, tail } = data as { head?: unknown; tail?: unknown }
    if (Array.isArray(head) && Array.isArray(tail)) {
      return head.length + tail.length
    }
  }
  return null
}

/**
 * Only persist our Firestore-backed queries that actually carry data — never
 * idle/disabled queries, nothing outside the `"firestore"` namespace, and no
 * list/infinite entry whose row count exceeds `MAX_PERSISTED_LIST_ROWS` (it
 * would dominate the blob; a skipped entry just refetches live on boot).
 *
 * @internal exported only for unit tests.
 */
export const shouldDehydrateQuery = (query: DehydrateCandidate): boolean => {
  if (query.state.status !== "success") return false
  if (!Array.isArray(query.queryKey) || query.queryKey[0] !== "firestore") {
    return false
  }
  const rows = entryRowCount(query.state.data)
  return rows === null || rows <= MAX_PERSISTED_LIST_ROWS
}

/**
 * Write the current dehydrated cache to storage NOW, bypassing the persister's
 * throttle. The installed `@tanstack/query-sync-storage-persister` exposes no
 * flush API — its throttle defers each save to a trailing timer that never
 * fires once the page is hidden/frozen or gone — so the lifecycle hooks in
 * `startQueryCachePersistence` dehydrate and write directly.
 */
const flushPersistedQueryCache = (): void => {
  if (typeof window === "undefined") return
  const persisted: PersistedClient = {
    buster: CACHE_BUSTER,
    timestamp: Date.now(),
    clientState: dehydrate(queryClient, { shouldDehydrateQuery }),
  }
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(tagTimestamps(persisted))
    )
  } catch {
    // Quota exceeded / storage unavailable — never throw during pagehide; the
    // next throttled save (or flush) retries with fresher data anyway.
  }
}

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
  const unsubscribe = persistQueryClientSubscribe({
    queryClient,
    persister,
    buster: CACHE_BUSTER,
    dehydrateOptions: { shouldDehydrateQuery },
  })
  if (typeof window === "undefined") return unsubscribe

  // Flush the throttle window on backgrounding: `visibilitychange` → hidden is
  // the modern lifecycle signal (tab switch, minimize, most closes) and
  // `pagehide` the fallback that still fires where it is missed (bfcache
  // navigations, some mobile closes). Without these, up to
  // `PERSIST_THROTTLE_MS` of cache changes would be lost on exit.
  const onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") flushPersistedQueryCache()
  }
  document.addEventListener("visibilitychange", onVisibilityChange)
  window.addEventListener("pagehide", flushPersistedQueryCache)
  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange)
    window.removeEventListener("pagehide", flushPersistedQueryCache)
    unsubscribe()
  }
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
