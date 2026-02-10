import { Timestamp } from "firebase/firestore"

// ============================================================================
// Domain Types
// ============================================================================

export interface ITeam {
  readonly id: string
  name: string
  photoURL?: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface IWorkspace {
  readonly id: string
  readonly teamId: string
  name: string
  description?: string | null
  photoURL?: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ============================================================================
// Workspace Nodes (Files/Folders)
// ============================================================================

export const ROOT_PARENT_ID = "root"
export const NODE_NAME_MAX_LENGTH = 128

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

export interface IUser {
  readonly uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  currentTeamId: string | null
  currentWorkspaceId: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type IMembershipRole = "owner" | "admin" | "member" | "guest"

export interface IMembership {
  readonly userId: string
  readonly teamId: string
  role: IMembershipRole
  user: IUser // Snapshot of user data
  team: ITeam // Snapshot of team data
  createdAt: Timestamp
  updatedAt: Timestamp
}

/**
 * Firestore document data for membership updates.
 * Used in batch operations and helpers to replace Record<string, unknown>.
 */
export interface IMembershipDocData {
  userId: string
  teamId: string
  role: IMembershipRole
  user: Partial<IUser>
  team: Partial<ITeam>
  createdAt?: Timestamp
  updatedAt?: Timestamp
}

// ============================================================================
// Audit Logs
// ============================================================================

export type LogResourceType = "team" | "workspace" | "content" | "membership"

export interface ILogActor {
  userId: string
  email?: string | null
  role?: string | null
}

export interface ILogResource {
  type: LogResourceType
  id: string
  parentId?: string | null
}

export interface ILogContext {
  ip?: string
  userAgent?: string
  authType?: "password" | "sso" | "api"
}

export interface ILogChanges {
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  fields?: string[]
}

export interface ILogEntry {
  readonly id: string
  timestamp: Timestamp
  teamId: string
  workspaceId?: string
  actor: ILogActor
  action: string
  resource: ILogResource
  context?: ILogContext
  changes?: ILogChanges
}

export type INotificationStatus = "inbox" | "saved" | "done"
export type INotificationType =
  | "user.welcome"
  | "invitation.received"
  | "invitation.declined"
  | "member.joined"
  | "member.removed"

export interface INotification {
  readonly id: string
  type: INotificationType
  title: string
  description: string
  url: string
  status: INotificationStatus
  read: boolean
  createdAt: Date
  source?: {
    entityType: string
    entityId: string
  }
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Generic result type for operations that can succeed or fail.
 * Provides type-safe error handling with discriminated union.
 */
export type Result<T, E = Error> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E }

/**
 * Helper to create a success result
 */
export function success<T>(data: T): Result<T, never> {
  return { success: true, data }
}

/**
 * Helper to create a failure result
 */
export function failure<E = Error>(error: E): Result<never, E> {
  return { success: false, error }
}

// ============================================================================
// Optimistic Update Types
// ============================================================================

/**
 * Generic interface for entities with an ID
 */
export interface IEntity {
  readonly id: string
}

/**
 * Options for Firestore operations with optimistic updates
 */
export interface IOptimisticOptions {
  /** Whether to show success toast notification */
  readonly showSuccessToast?: boolean
  /** Whether to show error toast notification */
  readonly showErrorToast?: boolean
  /** Custom success message */
  readonly successMessage?: string
  /** Custom error message */
  readonly errorMessage?: string
}

/**
 * State for tracking pending operations in a store
 */
export interface IPendingState {
  /** Set of IDs for operations currently in-flight */
  readonly pendingIds: ReadonlySet<string>
}
