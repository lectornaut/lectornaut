import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
  type SnapshotOptions,
} from "firebase/firestore"
import type { ZodError, ZodObject, ZodRawShape, ZodType } from "zod"

/**
 * Schema validation utilities shared across every boundary.
 *
 * Pick the right helper for the layer you're at:
 *
 *   parseSafe    — non-throwing, returns null on failure. Streaming reads.
 *   parseOrWarn  — dev throws, prod degrades silently. Firestore converter.
 *   assertValid  — always throws. Writes and outbox enqueues.
 *
 * Violations are reported through `violationSink`. Bootstrap code should
 * redirect the sink via `setSchemaViolationSink` to integrate with logging,
 * Sentry, or a dev-only toast.
 */

// ─── Error types ─────────────────────────────────────────────────────────────

/**
 * Structured payload emitted when a schema violation occurs. Prefer sending
 * `error.issues` to telemetry — `raw` may contain PII.
 */
export interface SchemaViolation {
  context: string
  error: ZodError
  raw: unknown
}

/**
 * Thrown by `assertValid` (writes) and rethrown by `parseOrWarn` in dev.
 * Carries enough context to log the exact field path that failed.
 *
 * Fields are declared explicitly (not as constructor parameter properties)
 * because the project's tsconfig has `erasableSyntaxOnly` enabled.
 */
export class SchemaValidationError extends Error {
  public readonly context: string
  public readonly zodError: ZodError
  public readonly raw: unknown

  constructor(context: string, zodError: ZodError, raw: unknown) {
    super(`Schema validation failed at ${context}`)
    this.name = "SchemaValidationError"
    this.context = context
    this.zodError = zodError
    this.raw = raw
  }
}

// ─── Violation sink ──────────────────────────────────────────────────────────

type Sink = (violation: SchemaViolation) => void

let violationSink: Sink = (violation) => {
  console.warn(
    `[schema] ${violation.context}`,
    violation.error.issues,
    violation.raw
  )
}

/**
 * Call once during bootstrap (main.ts) to redirect violations to Sentry,
 * a toast, or any custom logger. Replaces the default console.warn sink.
 */
export function setSchemaViolationSink(sink: Sink): void {
  violationSink = sink
}

// ─── Core parse helpers ──────────────────────────────────────────────────────

/**
 * Non-throwing: logs on failure and returns null. Use for streaming reads
 * where one corrupt row must not throw the whole list.
 *
 * In prod, returns the raw cast without running the schema — zero overhead
 * on the hot path. The dev/prod gate is a compile-time constant, so the
 * branch is eliminated by the minifier in production builds.
 */
export function parseSafe<T>(
  schema: ZodType<T>,
  data: unknown,
  context: string
): T | null {
  if (!import.meta.env.DEV) return data as T
  const result = schema.safeParse(data)
  if (result.success) return result.data
  violationSink({ context, error: result.error, raw: data })
  return null
}

/**
 * Read-path default. In dev, throws on failure (loud). In prod, skips
 * validation entirely and returns the raw cast — zero overhead on the
 * hot path, dead branch eliminated by the minifier.
 *
 * Used inside `zodConverter`, so every Firestore snapshot flows through it.
 */
export function parseOrWarn<T>(
  schema: ZodType<T>,
  data: unknown,
  context: string
): T {
  if (!import.meta.env.DEV) return data as T
  const result = schema.safeParse(data)
  if (result.success) return result.data
  violationSink({ context, error: result.error, raw: data })
  throw result.error
}

/**
 * Write-path default. Throws in dev AND prod. Blocks bad data reaching
 * Firestore. Runs unconditionally — bad writes are rare, expensive, and
 * worth the overhead.
 */
export function assertValid<T>(
  schema: ZodType<T>,
  data: unknown,
  context: string
): T {
  const result = schema.safeParse(data)
  if (result.success) return result.data
  violationSink({ context, error: result.error, raw: data })
  throw new SchemaValidationError(context, result.error, data)
}

// ─── Legacy timestamp coercion ──────────────────────────────────────────────

/**
 * Recursively converts legacy numeric timestamps (epoch seconds or
 * milliseconds) into Firestore `Timestamp` instances.
 *
 * All current write paths use `Timestamp.now()` or `serverTimestamp()`,
 * but older documents may still contain plain numbers. This function
 * normalizes them at the read boundary so schemas can stay strict
 * (`z.instanceof(Timestamp)`) without rejecting legacy data.
 */
const TIMESTAMP_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "archivedAt",
  "lastActiveAt",
  "resentAt",
])

function coerceNumericTimestamps(
  data: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...data }
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "number" && TIMESTAMP_FIELDS.has(key)) {
      const secs = value > 1e12 ? Math.floor(value / 1000) : value
      const nanos = value > 1e12 ? (value % 1000) * 1e6 : 0
      result[key] = new Timestamp(secs, nanos)
    } else if (
      value !== null &&
      typeof value === "object" &&
      !(value instanceof Timestamp) &&
      !(value instanceof FieldValue) &&
      !Array.isArray(value)
    ) {
      result[key] = coerceNumericTimestamps(value as Record<string, unknown>)
    }
  }
  return result
}

// ─── Firestore converter factory ─────────────────────────────────────────────

/**
 * Builds a `FirestoreDataConverter` that validates on read via `parseOrWarn`.
 *
 * `toFirestore` is a pass-through: writes are validated elsewhere (sync
 * engine path registry), so running a schema here would double-validate
 * every mutation.
 *
 * Plug into a ref in `firebase-helpers.ts`:
 *
 *   const userConverter = zodConverter(userSchema, "user")
 *   export const getUserRef = (uid: string) =>
 *     doc(firestore, "users", uid).withConverter(userConverter)
 *
 * The TanStack read composables (`useDocumentQuery` / `useCollectionQuery`)
 * read through the converter, so it validates on every snapshot.
 */
export function zodConverter<T extends DocumentData>(
  schema: ZodType<T>,
  context: string
): FirestoreDataConverter<T> {
  return {
    toFirestore(value: T): DocumentData {
      return value as DocumentData
    },
    fromFirestore(snap: QueryDocumentSnapshot, options?: SnapshotOptions): T {
      const data = coerceNumericTimestamps(snap.data(options))
      // Inject `snap.id` into the parsed data. The doc's path-derived id
      // is canonical; storing it in the body is denormalization. This
      // makes schemas with `id: z.string()` parse cleanly even when the
      // body was written without explicit `id` (legacy docs, or docs
      // written by code that didn't denormalize). Spread before `id` so
      // an explicit body value is overridden by the canonical one.
      return parseOrWarn(
        schema,
        { ...data, id: snap.id },
        `${context}:${snap.ref.path}`
      )
    },
  }
}

// ─── Partial-update helper (writes) ──────────────────────────────────────────

/**
 * Validate a Firestore `.update()` / `.set(…, { merge: true })` payload.
 *
 * In prod, the entire function body is eliminated by the minifier — all
 * keys pass through without validation. The rules below apply in dev.
 *
 * Rules:
 *   - FieldValue sentinels (serverTimestamp, arrayUnion, increment, …)
 *     pass through without validation.
 *   - Dotted field paths like `"billing.stripeCustomerId"` pass through.
 *     Resolving nested schemas is complex and the benefit is small —
 *     Firestore security rules guard structural integrity.
 *   - Unknown keys warn (and pass).
 *   - Flat keys with plain values are validated against the field's own
 *     schema in isolation. Invalid values throw `SchemaValidationError`.
 */
export function validatePartialUpdate(
  schema: ZodObject<ZodRawShape>,
  data: Record<string, unknown>,
  context: string
): Record<string, unknown> {
  if (!import.meta.env.DEV) return data
  const shape = schema.shape as Record<string, ZodType<unknown>>
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof FieldValue) continue
    if (key.includes(".")) continue
    const fieldSchema = shape[key]
    if (!fieldSchema) {
      console.warn(`[schema] ${context}: unknown field "${key}"`, value)
      continue
    }
    const result = fieldSchema.safeParse(value)
    if (!result.success) {
      violationSink({
        context: `${context}:${key}`,
        error: result.error,
        raw: value,
      })
      throw new SchemaValidationError(`${context}:${key}`, result.error, value)
    }
  }
  return data
}
