/**
 * Shared Cloud Functions Runtime Configuration
 *
 * Provides consistent, right-sized runtime options for all function categories.
 * Keeps region, memory, timeout, and instance limits in one place.
 *
 * Gen 2 functions support concurrency (multiple requests per instance).
 * Right-sizing concurrency helps reduce cold starts and instance churn.
 */

function envInt(key: string, fallback: number): number {
  const raw = process.env[key]
  if (raw === undefined) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, parsed)
}

/** Primary region — should match Firestore location to minimize latency/egress */
export const REGION = "us-central1"

/**
 * Callable / HTTP function defaults (Gen 2)
 * - concurrency: 80 allows multiple requests per instance, reducing cost
 * - maxInstances: capped to prevent runaway scaling
 */
export const CALLABLE_OPTS = {
  region: REGION,
  memory: "256MiB" as const,
  timeoutSeconds: 60,
  maxInstances: 40,
  concurrency: 80,
  invoker: "public" as const,
}

/**
 * Destructive callable defaults (Gen 2)
 * Used for deleteTeam, deleteWorkspace — operations that use recursiveDelete()
 * which can traverse large subcollection trees.
 * - Higher memory and timeout to handle batch deletion of deep document trees
 * - Lower concurrency to limit Firestore write throughput spikes
 */
export const DESTRUCTIVE_CALLABLE_OPTS = {
  region: REGION,
  memory: "512MiB" as const,
  timeoutSeconds: 300,
  maxInstances: 5,
  concurrency: 10,
  invoker: "public" as const,
}

/**
 * Firestore trigger function defaults
 * - Explicit concurrency to avoid overly low single-request containers
 * - timeoutSeconds: 120 for potentially longer operations
 */
export const TRIGGER_OPTS = {
  region: REGION,
  memory: "256MiB" as const,
  timeoutSeconds: 120,
  maxInstances: 10,
  concurrency: 10,
}

/**
 * Scheduled function defaults
 * - Lower maxInstances since schedulers run infrequently
 * - Higher timeout for batch cleanup operations
 */
export const SCHEDULED_OPTS = {
  region: REGION,
  memory: "256MiB" as const,
  timeoutSeconds: 300,
  maxInstances: 1,
  concurrency: 1,
}

/**
 * Email function defaults
 * - Higher memory for MJML template rendering
 */
export const EMAIL_OPTS = {
  region: REGION,
  memory: "256MiB" as const,
  timeoutSeconds: 60,
  maxInstances: 10,
  concurrency: 20,
}

/**
 * App Check token exchange endpoint is latency-sensitive on client bootstrap.
 * Default minInstances is 0 to avoid idle billing (override with APP_CHECK_MIN_INSTANCES).
 */
export const APP_CHECK_OPTS = {
  ...CALLABLE_OPTS,
  minInstances: envInt("APP_CHECK_MIN_INSTANCES", 0),
  maxInstances: 10,
}

/** Default sender address for outbound emails (override via EMAIL_FROM_ADDRESS) */
export const EMAIL_FROM =
  process.env.EMAIL_FROM_ADDRESS || "hello@lectornaut.com"

/**
 * AI generation workloads are CPU/memory heavier than regular CRUD callables.
 *
 * `timeoutSeconds` MUST stay comfortably above `bot.ts`'s `TURN_DEADLINE_MS`
 * (the in-app per-turn wall-clock). The flow races the provider call against
 * that deadline and, on expiry, aborts the provider call and streams a
 * graceful fallback chunk before returning. If the Cloud Functions timeout
 * fired first, the instance would be hard-killed mid-stream and the client
 * would see an opaque INTERNAL instead — so the function timeout has to give
 * the deadline room to land. 120s = 90s deadline + 30s headroom for the
 * fallback write + unary return. Keep these two in sync if either changes.
 */
export const GENKIT_OPTS = {
  region: REGION,
  memory: "512MiB" as const,
  timeoutSeconds: 120,
  maxInstances: 5,
  concurrency: 10,
  invoker: "public" as const,
}
