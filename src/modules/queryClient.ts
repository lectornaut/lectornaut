import { isRetryableReadError } from "@/utils/firebase/firebase-errors"
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
 *   - `retry` — use the READ error taxonomy (`isRetryableReadError`): the
 *     transient infra codes (`unavailable`/`deadline-exceeded`/…) PLUS
 *     `permission-denied`/`unauthenticated`, which are transient at cold start
 *     when a listener opens before the Auth/App-Check token is ready. Without
 *     retrying those, a single lost token-warm-up race left a bootstrap query's
 *     `data` undefined forever and hung the app shell on its loading gate (the
 *     "infinite workspace loading" bug). `not-found` stays non-retryable.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: (failureCount, error) =>
        failureCount < MAX_QUERY_RETRIES && isRetryableReadError(error),
    },
    mutations: {
      // The sync engine owns write retries/backoff/dead-lettering. Query-level
      // mutation retries would re-enqueue an already-durable command, so leave
      // them off and let the engine decide what to resend.
      retry: false,
    },
  },
})

/**
 * Self-heal for terminally-errored queries. `refetchOnReconnect: false` above
 * is correct for HEALTHY queries — their listener re-delivers on its own — but
 * an errored query has no listener left: once the retries above exhaust it
 * stays errored (and, never having succeeded, permanently stale) for the rest
 * of the session, wedging every bootstrap gate derived from it. When
 * connectivity returns, refetch exactly the errored set; healthy queries stay
 * untouched.
 */
export const isErroredQuery = (query: { state: { status: string } }): boolean =>
  query.state.status === "error"

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    void queryClient.refetchQueries({ predicate: isErroredQuery })
  })
}
