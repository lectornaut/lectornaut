import type {
  logActionSchema,
  logActorSchema,
  logChangesSchema,
  logContextSchema,
  logEntrySchema,
  logResourceSchema,
  logResourceTypeSchema,
} from "@/schemas/logs"
import type { z } from "zod"

/**
 * Audit log type aliases — re-exported from `src/schemas/logs.ts`.
 */

export type LogResourceType = z.infer<typeof logResourceTypeSchema>
export type LogAction = z.infer<typeof logActionSchema>
export type ILogActor = z.infer<typeof logActorSchema>
export type ILogResource = z.infer<typeof logResourceSchema>
export type ILogContext = z.infer<typeof logContextSchema>
export type ILogChanges = z.infer<typeof logChangesSchema>
export type ILogEntry = z.infer<typeof logEntrySchema>
