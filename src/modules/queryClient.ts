import { isRetryableFirebaseError } from "@/utils/firebase/firebase-errors"
import { QueryClient } from "@tanstack/vue-query"

/**
 * Maximum automatic retries for a failed *read* query — i.e. the realtime
 * listener's initial connection (see `firebase-query.ts`). Mutations default to
 * `retry: false` because the sync engine (`firebase-sync-engine.ts`) already
 * owns write durability, exponential backoff, and dead-lettering; re-retrying
 * at the Query layer would double-submit the command.
 */
const MAX_QUERY_RETRIES = 3

/**
 * The single app-wide QueryClient.
 *
 * Created here (not inside the Vue plugin) so non-component code — the realtime
 * subscription manager, cache persistence, and logout cleanup — can share the
 * exact same instance via direct import.
 *
 * Defaults reflect that Firestore is *push-based*. Realtime `onSnapshot`
 * listeners keep cached data fresh, so Query's pull-based refetching must never
 * fight them:
 *   - `staleTime: Infinity` — data is never considered stale; the listener, not
 *     a timed refetch, is the freshness mechanism.
 *   - `refetchOnWindowFocus` / `refetchOnReconnect: false` — both are redundant
 *     here; the listener re-delivers automatically when the tab refocuses or the
 *     connection is restored.
 *   - `retry` — defer to the existing Firestore error taxonomy: retry only the
 *     transient codes (`unavailable`/`deadline-exceeded`/…), never
 *     `permission-denied` or `not-found`.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: (failureCount, error) =>
        failureCount < MAX_QUERY_RETRIES && isRetryableFirebaseError(error),
    },
    mutations: {
      // The sync engine owns write retries/backoff/dead-lettering. Query-level
      // mutation retries would re-enqueue an already-durable command, so leave
      // them off and let the engine decide what to resend.
      retry: false,
    },
  },
})
