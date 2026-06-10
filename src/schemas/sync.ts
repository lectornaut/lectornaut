import { SYNC_MUTATION_TYPES } from "@lectornaut/shared/domain"
import { z } from "zod"

/**
 * Sync engine schemas — replace the hand-rolled type guards and local
 * interfaces inside `src/utils/firebase/firebase-sync-engine.ts` in PR 5.
 *
 * The outbox is a localStorage-backed queue of pending Firestore mutations
 * that must survive offline periods and app restarts. Every entry entering
 * the outbox is validated on read (`syncOutboxOperationSchema.safeParse`),
 * and corrupt entries are quarantined — without ever reaching the retry loop.
 */

export const syncMutationTypeSchema = z.enum(SYNC_MUTATION_TYPES)

/**
 * The client outbox *queue lifecycle*. Deliberately NOT hoisted to
 * `@lectornaut/shared/domain`: the server's `SyncOperationStatus`
 * (`pending | ack | reject`) is a different state machine (per-op Firestore
 * ack), not a drifted copy of this one — only `SyncMutationType` is shared.
 */
export const syncOperationStatusSchema = z.enum([
  "pending",
  "sent",
  "acked",
  "rejected",
])

export const syncBaseVersionSchema = z.object({
  field: z.string(),
  value: z.union([z.number(), z.string(), z.null()]),
})

export const syncMutatePayloadSchema = z.object({
  source: z.string(),
  targetPath: z.string(),
  type: syncMutationTypeSchema,
  data: z.record(z.string(), z.unknown()).optional(),
  merge: z.boolean().optional(),
  baseVersion: syncBaseVersionSchema.nullable().optional(),
})

export const syncOutboxOperationSchema = syncMutatePayloadSchema.extend({
  id: z.string(),
  userId: z.string(),
  clientId: z.string(),
  status: syncOperationStatusSchema,
  attempts: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  sentAt: z.number().optional(),
  settledAt: z.number().optional(),
  errorMessage: z.string().optional(),
  /**
   * True once the remote operation document was successfully created. Retries
   * of a created op re-invoke the `applySyncOperation` callable instead of
   * rewriting the doc (a rewrite is an update — `onDocumentCreated` never
   * re-fires for it, so it can't help). Optional so entries persisted by
   * older app versions still parse.
   */
  remoteCreated: z.boolean().optional(),
})

/**
 * Inferred types for sync engine consumers.
 *
 * Unlike the domain schemas (where PR 3 swapped the `src/types/*.ts`
 * interfaces to `z.infer` aliases), these types were never in `src/types/`
 * to begin with — they lived locally inside `firebase-sync-engine.ts`. PR 5
 * relocates the canonical definitions here alongside the runtime schema.
 */
export type SyncMutatePayload = z.infer<typeof syncMutatePayloadSchema>
export type SyncOutboxOperation = z.infer<typeof syncOutboxOperationSchema>
