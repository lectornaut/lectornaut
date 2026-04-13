import type {
  syncBaseVersionSchema,
  syncMutationTypeSchema,
  syncOperationStatusSchema,
} from "@/schemas/sync"
import type { z } from "zod"

/**
 * Sync metadata type aliases — re-exported from `src/schemas/sync.ts`.
 *
 * The richer `SyncMutatePayload` / `SyncOutboxOperation` types still live
 * locally in `src/utils/firebase/firebase-sync-engine.ts`. PR 5 replaces
 * those with the schema-derived versions from `src/schemas/sync.ts`.
 */

export type SyncMutationType = z.infer<typeof syncMutationTypeSchema>
export type SyncOperationStatus = z.infer<typeof syncOperationStatusSchema>
export type SyncBaseVersion = z.infer<typeof syncBaseVersionSchema>
