import { FieldValue, Timestamp } from "firebase/firestore"
import { z } from "zod"

/**
 * `z.instanceof(FieldValue)` doesn't compile because the Firebase SDK gives
 * `FieldValue` a private constructor, and Zod's type constraint for
 * `instanceof` requires a public one. `z.custom()` with a runtime check is
 * the idiomatic workaround.
 */
const isFieldValue = (value: unknown): value is FieldValue =>
  value instanceof FieldValue

/**
 * Schema primitives shared across every domain schema.
 *
 * Firestore's `Timestamp` is a class, and `serverTimestamp()` returns a
 * `FieldValue` sentinel — so read-schemas and write-schemas diverge on
 * timestamp fields. These primitives hide that split behind three building
 * blocks that every domain schema composes.
 */

/**
 * Read-side: Firestore always returns Timestamp instances for resolved
 * server timestamps.
 * Use this in domain `fooSchema` definitions.
 */
export const timestampSchema = z.instanceof(Timestamp)

/**
 * Write-side: accepts a real Timestamp OR a FieldValue sentinel
 * (serverTimestamp, arrayUnion, increment, delete, …). Use this in
 * `fooWriteSchema` definitions where outgoing mutations may carry sentinels.
 */
export const timestampInputSchema = z.union([
  z.instanceof(Timestamp),
  z.custom<FieldValue>(isFieldValue, {
    message: "Expected FieldValue sentinel (e.g. serverTimestamp())",
  }),
])

/**
 * A FieldValue sentinel alone — for fields that only ever receive a
 * FieldValue (e.g. `versionCount: increment(1)` on update).
 */
export const fieldValueSchema = z.custom<FieldValue>(isFieldValue, {
  message: "Expected FieldValue sentinel",
})

/**
 * Hydration-side: parses either a real Timestamp OR its JSON-serialized
 * form (`{ seconds, nanoseconds }`) back into a Timestamp instance.
 *
 * Used exclusively by `useLocalHydration` since localStorage round-trips
 * strip the Timestamp class identity. Do not use for Firestore reads or
 * writes — `timestampSchema` / `timestampInputSchema` are the right choice
 * for those paths.
 */
export const timestampHydratedSchema = z.union([
  z.instanceof(Timestamp),
  z
    .object({ seconds: z.number(), nanoseconds: z.number() })
    .transform(
      ({ seconds, nanoseconds }) => new Timestamp(seconds, nanoseconds)
    ),
])
