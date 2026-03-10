import { Timestamp } from "firebase/firestore"

export const ROOT_PARENT_ID = "root"
export const NODE_NAME_MAX_LENGTH = 128
export const ATTACHMENT_NAME_MAX_LENGTH = 255

export type NodeType = "folder" | "file"
export type WorkspaceNodeScope = "code" | "write"

export interface NodeBase {
  readonly id: string
  readonly workspaceId: string
  type: NodeType
  /** Folders first, then files */
  typeOrder: number
  name: string
  nameLower: string
  parentId: string
  isArchived: boolean
  archivedAt?: Timestamp
  archivedBy?: string
  createdAt: Timestamp
  createdBy: string
  updatedAt: Timestamp
  updatedBy: string
  sortKey?: string
}

export interface FolderNode extends NodeBase {
  type: "folder"
}

export interface FileNode extends NodeBase {
  type: "file"
  content?: string
  mimeType?: string
  size?: number
}

export type WorkspaceNode = FolderNode | FileNode

export interface WorkspaceNodeAttachment {
  readonly id: string
  readonly workspaceId: string
  readonly nodeId: string
  scope: WorkspaceNodeScope
  displayName: string
  originalName: string
  storagePath: string
  mimeType?: string | null
  size?: number | null
  createdAt: Timestamp
  createdBy: string
  updatedAt: Timestamp
  updatedBy: string
}

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
