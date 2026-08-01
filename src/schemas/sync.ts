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
 *
 * `parked` is purely client-local — an op that exhausted its send attempts
 * without ever receiving a server verdict — and in fact purely IN-MEMORY: it
 * maps to the remote `pending` status when written to Firestore (rules
 * constrain the op-doc enum) AND is demoted to `pending` when persisted to
 * the shared localStorage outbox (older app versions quarantine-and-drop
 * statuses outside their enum — see `toPersistedOperations`). The member
 * stays in this schema so in-memory snapshots still validate.
 */
export const syncOperationStatusSchema = z.enum([
  "pending",
  "sent",
  "acked",
  "rejected",
  "parked",
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

/**
 * One persisted outbox entry.
 *
 * SETTLED (acked/rejected) entries are stored PAYLOAD-LESS: the engine strips
 * `data` and `baseVersion` the moment a verdict lands (see
 * `stripSettledOperationPayload` in `firebase-sync-queue.ts`) because settled
 * retention only serves duplicate-verdict dedup and metrics, while retaining
 * an hour of ~1MB snapshot payloads would blow the localStorage quota. Both
 * fields therefore MUST stay optional/absent-tolerant here — stripped entries
 * and old fat entries persisted by earlier builds parse alike.
 */
export const syncOutboxOperationSchema = syncMutatePayloadSchema.extend({
  id: z.string(),
  userId: z.string(),
  clientId: z.string(),
  status: syncOperationStatusSchema,
  attempts: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /**
   * When the last FULL (ladder) attempt was sent. Fast retries deliberately
   * never restamp it: retry eligibility and fast-vs-full classification both
   * measure from this anchor, so a burst of detected callable failures cannot
   * restart the ladder clock and stretch time-to-park past ~45s.
   */
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
  /**
   * Consecutive fast retries since the last full (ladder) attempt. Fast
   * retries re-invoke the callable after a DETECTED transport failure and are
   * tracked separately from `attempts` so they cannot burn the attempt budget
   * early. Optional (like every field below) so entries persisted by older
   * app versions still parse.
   */
  fastRetries: z.number().optional(),
  /**
   * Eligibility pulled forward by a detected callable failure: the op may
   * re-send at this timestamp instead of waiting out the full ladder window.
   * The ladder remains the ceiling — see `computeRetryInMs`.
   */
  nextEligibleAt: z.number().optional(),
  /** When the op entered the `parked` status (diagnostics only). */
  parkedAt: z.number().optional(),
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
