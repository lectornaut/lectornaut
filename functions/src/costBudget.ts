/**
 * Cost Budget Configuration
 *
 * Environment-driven defaults that set sane limits across the codebase.
 * Override any value via environment variables for staging/prod tuning.
 *
 * Usage:
 *   import { COST_BUDGET } from "./costBudget.js"
 *   const results = await query.limit(COST_BUDGET.QUERY_MAX_LIMIT).get()
 */

function envInt(key: string, fallback: number): number {
  const raw = process.env[key]
  if (raw === undefined) return fallback
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const COST_BUDGET = {
  /** Maximum documents any single Firestore query should return */
  QUERY_MAX_LIMIT: envInt("COST_QUERY_MAX_LIMIT", 500),

  /** Maximum writes per batch operation (Firestore limit is 500) */
  MAX_BATCH_SIZE: envInt("COST_MAX_BATCH_SIZE", 450),

  /** Maximum depth of trigger cascading (write → trigger → write → ...) */
  MAX_FANOUT_DEPTH: envInt("COST_MAX_FANOUT_DEPTH", 3),

  /** Default maxInstances cap per function */
  FUNCTION_MAX_INSTANCES: envInt("COST_FUNCTION_MAX_INSTANCES", 100),

  /** Maximum number of recipients per notification fan-out */
  NOTIFICATION_FANOUT_MAX: envInt("COST_NOTIFICATION_FANOUT_MAX", 50),

  /** TTL for in-memory notification preference cache (ms) */
  PREFERENCE_CACHE_TTL_MS: envInt("COST_PREFERENCE_CACHE_TTL_MS", 60_000),

  /** Maximum device sessions per user before oldest are evicted */
  MAX_SESSIONS: envInt("COST_MAX_SESSIONS", 20),

  /** Maximum number of owner-check reads (only need 2 to know if >1) */
  OWNER_CHECK_LIMIT: 2,

  /** Maximum number of member-check reads (only need 2 to know if >1) */
  MEMBER_CHECK_LIMIT: 2,
} as const
