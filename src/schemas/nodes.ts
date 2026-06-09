import { NODE_SCOPES, NODE_TYPES } from "@lectornaut/shared/domain"
import { z } from "zod"
import { timestampSchema } from "./_primitives"

/**
 * Workspace node schemas — mirror `src/types/nodes.ts`.
 *
 * `WorkspaceNode` is a discriminated union keyed on `type` ("folder" | "file").
 * Using `z.discriminatedUnion` instead of `z.union` is a meaningful perf win
 * on hot read paths: Zod narrows to a single branch by reading the
 * discriminant instead of trying both branches and merging errors.
 *
 * No write schema variant yet — node writes use dotted field paths and
 * FieldValue sentinels extensively, and `validatePartialUpdate`'s flat-key
 * strategy covers the common case. If stricter write validation is needed,
 * add a dedicated write schema in a later PR.
 */

export const nodeTypeSchema = z.enum(NODE_TYPES)
export const workspaceNodeScopeSchema = z.enum(NODE_SCOPES)

// Shared base object. `nodeBaseSchema` exposes it as a standalone schema
// (for callers that want to validate the common fields only); the folder
// and file schemas extend it with their discriminant and file-only fields.
const nodeBaseObject = z.object({
  id: z.string(),
  workspaceId: z.string(),
  type: nodeTypeSchema,
  /** Folders first (0), then files (1). */
  typeOrder: z.number(),
  name: z.string(),
  nameLower: z.string(),
  parentId: z.string(),
  isArchived: z.boolean(),
  archivedAt: timestampSchema.optional(),
  archivedBy: z.string().optional(),
  createdAt: timestampSchema,
  createdBy: z.string(),
  updatedAt: timestampSchema,
  updatedBy: z.string(),
  sortKey: z.string().optional(),
})

export const nodeBaseSchema = nodeBaseObject

export const folderNodeSchema = nodeBaseObject.extend({
  type: z.literal("folder"),
})

export const fileNodeSchema = nodeBaseObject.extend({
  type: z.literal("file"),
  content: z.string().optional(),
  mimeType: z.string().optional(),
  size: z.number().optional(),
})

/**
 * Discriminated union — branches on `type`. Parsing is O(1) wrt the branch
 * count because Zod narrows before attempting a branch.
 */
export const workspaceNodeSchema = z.discriminatedUnion("type", [
  folderNodeSchema,
  fileNodeSchema,
])

export const workspaceNodeAttachmentSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  nodeId: z.string(),
  scope: workspaceNodeScopeSchema,
  displayName: z.string(),
  originalName: z.string(),
  storagePath: z.string(),
  mimeType: z.string().nullable().optional(),
  size: z.number().nullable().optional(),
  createdAt: timestampSchema,
  createdBy: z.string(),
  updatedAt: timestampSchema,
  updatedBy: z.string(),
})

/**
 * Chat-session attachment — same shape as a node attachment but scoped to a
 * bot chat session (`sessionId`) instead of a workspace node (`nodeId`+`scope`).
 */
export const botSessionAttachmentSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  sessionId: z.string(),
  displayName: z.string(),
  originalName: z.string(),
  storagePath: z.string(),
  mimeType: z.string().nullable().optional(),
  size: z.number().nullable().optional(),
  createdAt: timestampSchema,
  createdBy: z.string(),
  updatedAt: timestampSchema,
  updatedBy: z.string(),
})
