import type { Timestamp } from "firebase/firestore"

/**
 * Coercion of Firestore `Timestamp`s at the read/UI boundary.
 *
 * Read schemas type these fields as `Timestamp` (see `timestampSchema`), but
 * call sites stay tolerant of `null`/`undefined` (optional fields) and of any
 * `.toDate()`-bearing shape so a single helper serves every consumer instead
 * of each component hand-rolling `?.toDate?.()`.
 */
type TimestampLike = Timestamp | { toDate?: () => Date } | null | undefined

/** Firestore `Timestamp` → `Date`, or `null` when the field is unset. */
export const tsToDate = (ts: TimestampLike): Date | null =>
  (ts as { toDate?: () => Date } | null | undefined)?.toDate?.() ?? null

/** Firestore `Timestamp` → epoch milliseconds, or `null` when unset. */
export const tsToMillis = (ts: TimestampLike): number | null =>
  tsToDate(ts)?.getTime() ?? null
