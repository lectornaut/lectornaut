import {
  MEMORY_CATEGORIES,
  MEMORY_SOURCES,
  MEMORY_VISIBILITY,
} from "@lectornaut/shared/domain"
import { z } from "zod"
import { timestampSchema } from "./_primitives"

/**
 * Memory schemas — the client read-side validation for
 * `teams/{teamId}/workspaces/{workspaceId}/memories/{id}`.
 *
 * Mirrors `botSessionSchema` (src/schemas/domain.ts): durable, searchable
 * notes scoped to a workspace, private to their author by default and
 * optionally `shared`. Writes are functions-only (`allow write: if false`),
 * so this is a *read* schema — extra body fields the server writes but the
 * client never needs (`embedding`, `embedHash`, `embedAt`) are stripped by
 * Zod's default object behavior and intentionally not declared here, exactly
 * like `nodeBaseSchema` omits the embedding columns.
 *
 * Strictness rule (cf. the "over-strict read schema silently drops rows"
 * scar): required only for fields *every* server write path sets
 * (id/teamId/workspaceId/ownerUid/content/category/source/importance, plus
 * `visibility` with a `"private"` default); everything the embed trigger or a
 * later recall bump adds lazily stays `.optional()`.
 */

export const memoryVisibilitySchema = z.enum(MEMORY_VISIBILITY)
export const memoryCategorySchema = z.enum(MEMORY_CATEGORIES)
export const memorySourceSchema = z.enum(MEMORY_SOURCES)

export const memorySchema = z.object({
  id: z.string(),
  // teamId + workspaceId are injected from the doc path by `memoryConverter`
  // (see firebase-helpers.ts) — canonically defined by the doc's location, so
  // they parse cleanly even on a doc that never denormalized them.
  teamId: z.string(),
  workspaceId: z.string(),
  /**
   * The principal who owns the memory — genuine body data (not path-derivable),
   * set by the create callable and never `undefined`. Drives the visibility
   * reads (house name, cf. botSessions' `ownerUid`).
   */
  ownerUid: z.string(),
  /** `"private"` (default) = owner-only; `"shared"` = workspace participants. */
  visibility: memoryVisibilitySchema.default("private"),
  /** Set when an agent wrote this memory (pairs with `source: "agent"`). */
  agentId: z.string().optional(),
  /** The memory text (embedded server-side). */
  content: z.string(),
  /** Short form for prompt injection / list preview. */
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  category: memoryCategorySchema,
  /** 0–100; feeds the recall importance boost (clamped in the handler). */
  importance: z.number(),
  source: memorySourceSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: timestampSchema.optional(),
  updatedAt: timestampSchema.optional(),
  /** Bumped best-effort on recall. */
  lastAccessedAt: timestampSchema.optional(),
  accessCount: z.number().optional(),
  /** Soft delete — mirror botSessions' `archivedAt`. */
  archived: z.boolean().default(false),
  archivedAt: timestampSchema.nullable().optional(),
  /** Recall boost. */
  pinned: z.boolean().default(false),
})

export type IMemory = z.infer<typeof memorySchema>
export type IMemoryVisibility = z.infer<typeof memoryVisibilitySchema>
export type IMemoryCategory = z.infer<typeof memoryCategorySchema>
export type IMemorySource = z.infer<typeof memorySourceSchema>
