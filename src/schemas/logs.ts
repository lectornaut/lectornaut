import { z } from "zod"
import { timestampSchema } from "./_primitives"

/**
 * Audit log schemas — mirror `src/types/logs.ts`.
 *
 * Logs are read from Firestore as a streaming paginated collection and
 * parsed with `parseSafe` in `usePaginatedLogs.ts`. One corrupt row must
 * never throw the whole list — that's why `parseSafe` (null on failure)
 * is the right tool, not `parseOrWarn`.
 */

export const logResourceTypeSchema = z.enum([
  "team",
  "workspace",
  "content",
  "membership",
])

export const logActorSchema = z.object({
  userId: z.string(),
  email: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
})

export const logResourceSchema = z.object({
  type: logResourceTypeSchema,
  id: z.string(),
  parentId: z.string().nullable().optional(),
})

export const logContextSchema = z.object({
  ip: z.string().optional(),
  userAgent: z.string().optional(),
  authType: z.enum(["password", "sso", "api"]).optional(),
})

export const logChangesSchema = z.object({
  before: z.record(z.string(), z.unknown()).optional(),
  after: z.record(z.string(), z.unknown()).optional(),
  fields: z.array(z.string()).optional(),
})

export const logEntrySchema = z.object({
  id: z.string(),
  timestamp: timestampSchema,
  teamId: z.string(),
  workspaceId: z.string().optional(),
  actor: logActorSchema,
  action: z.string(),
  resource: logResourceSchema,
  context: logContextSchema.optional(),
  changes: logChangesSchema.optional(),
})
