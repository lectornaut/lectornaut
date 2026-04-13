/**
 * Dev/prod gating for schema validation.
 *
 * Defaults:
 *   - Dev: validate everything (loud errors on bad data)
 *   - Prod: skip non-write validation (writes are always validated)
 *
 * Override via `VITE_VALIDATE_SCHEMAS`:
 *   - `VITE_VALIDATE_SCHEMAS=false` disables read-path validation in dev
 *     (useful for performance profiling)
 *   - `VITE_VALIDATE_SCHEMAS=true`  enables read-path validation in prod
 *     (useful for incident investigation)
 *
 * Note: writes via `assertValid` are ALWAYS validated, regardless of this
 * flag. Bad writes are rare and expensive, so the safety is worth the cost.
 */

export const isDev = import.meta.env.DEV

const envFlag = import.meta.env.VITE_VALIDATE_SCHEMAS as
  | "true"
  | "false"
  | undefined

export const shouldValidate = isDev ? envFlag !== "false" : envFlag === "true"
