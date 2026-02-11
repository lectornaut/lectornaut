/**
 * Shared Cloud Functions Runtime Configuration
 *
 * Provides consistent, right-sized runtime options for all function categories.
 * Keeps region, memory, timeout, and instance limits in one place.
 *
 * Gen 2 functions support concurrency (multiple requests per instance),
 * which significantly reduces instance count and cold starts.
 */

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
  maxInstances: 100,
  concurrency: 80,
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
  maxInstances: 20,
  concurrency: 10,
}

/**
 * Firestore trigger function defaults
 * - concurrency 1: triggers should process one event at a time to avoid races
 * - timeoutSeconds: 120 for potentially longer operations
 */
export const TRIGGER_OPTS = {
  region: REGION,
  memory: "256MiB" as const,
  timeoutSeconds: 120,
  maxInstances: 50,
}

/**
 * Scheduled function defaults
 * - Lower maxInstances since schedulers run infrequently
 * - Higher timeout for batch cleanup operations
 */
export const SCHEDULED_OPTS = {
  region: REGION,
  memory: "256MiB" as const,
  timeoutSeconds: 540,
  maxInstances: 5,
}

/**
 * Email function defaults
 * - Higher memory for MJML template rendering
 */
export const EMAIL_OPTS = {
  region: REGION,
  memory: "512MiB" as const,
  timeoutSeconds: 60,
  maxInstances: 50,
  concurrency: 40,
}
