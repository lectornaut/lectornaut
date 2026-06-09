import {
  AUDIT_ACTIONS,
  AUTH_TYPES,
  LOG_RESOURCE_TYPES,
} from "@lectornaut/shared/domain"
import { z } from "zod"
import { timestampSchema } from "./_primitives"

/**
 * Audit log schemas — mirror `src/types/logs.ts`.
 *
 * Logs are read from Firestore as a streaming paginated collection and
 * parsed with `parseSafe` in `usePaginatedLogs.ts`. One corrupt row must
 * never collapse or fake the whole list — that's why `parseSafe` (drop +
 * report the row) is the right tool, not the schema converter (which would
 * best-effort a bad row through) or `assertValid` (which would throw).
 */

export const logResourceTypeSchema = z.enum(LOG_RESOURCE_TYPES)

export const logActionSchema = z.enum(AUDIT_ACTIONS)

export const logActorSchema = z.object({
  // Optional: an autonomous Workflows run has no driving human, so an agent
  // edit carries only `agentId`/`agentName` and omits `userId`. The server's
  // `normalizeActor` writes it omit-or-string, never null (mirrors the
  // `Actor.userId?: string` write contract). Requiring it here silently
  // dropped every headless agent log on read — the activity feed went blank.
  userId: z.string().optional(),
  email: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  // Present when an agent member performed the action on the user's behalf:
  // `userId` is the human who drove the turn; `agentId`/`agentName` identify
  // the agent that executed it.
  agentId: z.string().nullable().optional(),
  agentName: z.string().nullable().optional(),
})

export const logResourceSchema = z.object({
  type: logResourceTypeSchema,
  id: z.string(),
  parentId: z.string().nullable().optional(),
})

export const logContextSchema = z.object({
  ip: z.string().optional(),
  userAgent: z.string().optional(),
  authType: z.enum(AUTH_TYPES).optional(),
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
  action: logActionSchema,
  resource: logResourceSchema,
  context: logContextSchema.optional(),
  changes: logChangesSchema.optional(),
})
