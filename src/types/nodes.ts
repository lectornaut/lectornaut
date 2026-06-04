import type {
  botSessionAttachmentSchema,
  fileNodeSchema,
  folderNodeSchema,
  nodeBaseSchema,
  nodeTypeSchema,
  workspaceNodeAttachmentSchema,
  workspaceNodeSchema,
  workspaceNodeScopeSchema,
} from "@/schemas/nodes"
import type { z } from "zod"

/**
 * Workspace node type aliases — re-exported from `src/schemas/nodes.ts`.
 *
 * Constants and helper functions stay here because they are runtime values,
 * not schema-derivable.
 */

export const ROOT_PARENT_ID = "root"
export const NODE_NAME_MAX_LENGTH = 128
export const ATTACHMENT_NAME_MAX_LENGTH = 255

export type NodeType = z.infer<typeof nodeTypeSchema>
export type WorkspaceNodeScope = z.infer<typeof workspaceNodeScopeSchema>

export type NodeBase = z.infer<typeof nodeBaseSchema>
export type FolderNode = z.infer<typeof folderNodeSchema>
export type FileNode = z.infer<typeof fileNodeSchema>
export type WorkspaceNode = z.infer<typeof workspaceNodeSchema>
export type WorkspaceNodeAttachment = z.infer<
  typeof workspaceNodeAttachmentSchema
>
export type IBotSessionAttachment = z.infer<typeof botSessionAttachmentSchema>

// ─── Runtime helpers ─────────────────────────────────────────────────────────

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ")
}

export function toNameLower(name: string): string {
  return normalizeName(name).toLowerCase()
}

export function getTypeOrder(type: NodeType): number {
  return type === "folder" ? 0 : 1
}

export function isFolder(
  node: WorkspaceNode | null | undefined
): node is FolderNode {
  return !!node && node.type === "folder"
}

export function isFile(
  node: WorkspaceNode | null | undefined
): node is FileNode {
  return !!node && node.type === "file"
}
