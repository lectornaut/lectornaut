import type {
  syncBaseVersionSchema,
  syncMutationTypeSchema,
  syncOperationStatusSchema,
} from "@/schemas/sync"
import type { z } from "zod"

/**
 * Sync metadata type aliases — re-exported from `src/schemas/sync.ts`.
 */

export type SyncMutationType = z.infer<typeof syncMutationTypeSchema>
export type SyncOperationStatus = z.infer<typeof syncOperationStatusSchema>
export type SyncBaseVersion = z.infer<typeof syncBaseVersionSchema>
