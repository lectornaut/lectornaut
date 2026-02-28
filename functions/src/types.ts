import admin from "firebase-admin"

// Notification Channel Types
export type NotificationChannel = "in-app" | "email"
export type NotificationCategory = "communication" | "marketing" | "security"
export type NotificationFrequency = "immediate" | "daily" | "weekly" | "none"

export interface ChannelConfig {
  inApp: boolean
  email: boolean
  category: NotificationCategory
}

export type NotificationStatus = "inbox" | "saved" | "done"
export type NotificationType =
  | "user.welcome"
  | "invitation.received"
  | "invitation.declined"
  | "member.joined"
  | "member.removed"

export interface NotificationCategorySettings {
  communication: boolean
  marketing: boolean
  security: boolean
}

export interface NotificationChannelSettings {
  email: boolean
  inApp: boolean
}

export interface NotificationSettings {
  categories: NotificationCategorySettings
  frequency: NotificationFrequency
  channels: NotificationChannelSettings
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  categories: {
    communication: true,
    marketing: true,
    security: true,
  },
  frequency: "immediate",
  channels: {
    email: true,
    inApp: true,
  },
}

// Default channel configuration for each notification type
export const NotificationTypeConfig: Record<NotificationType, ChannelConfig> = {
  "user.welcome": {
    inApp: true,
    email: true,
    category: "marketing",
  },
  "invitation.received": {
    inApp: true,
    email: true,
    category: "communication",
  },
  "invitation.declined": {
    inApp: true,
    email: true,
    category: "communication",
  },
  "member.joined": {
    inApp: true,
    email: true,
    category: "communication",
  },
  "member.removed": {
    inApp: true,
    email: true,
    category: "security",
  },
}

export interface NotificationData {
  type: NotificationType
  title: string
  description: string
  url: string
  status: NotificationStatus
  read: boolean
  source?: {
    entityType: string
    entityId: string
  }
  createdAt: admin.firestore.FieldValue
}

export interface EmailData {
  email: string
  subject: string
  body?: string
  template?: string
  data?: Record<string, unknown>
}
export interface InvitationData {
  teamId: string
  teamName: string
  inviterName: string
  inviterEmail: string
  email: string
  role: string
  status: "pending" | "declined"
  code: string
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue
  resentAt?: admin.firestore.Timestamp | admin.firestore.FieldValue
}

// ============================================================================
// Sync Types
// ============================================================================

export type SyncMutationType = "set" | "update" | "delete"
export type SyncOperationStatus = "pending" | "ack" | "reject"

export interface SyncBaseVersion {
  field: string
  value: number | string | null
}

/**
 * Normalize a Firestore field value into a comparable primitive.
 * Handles Timestamps, Dates, numbers, and strings.
 * Used for base version comparison in sync operations.
 */
export const normalizeComparable = (value: unknown): number | string | null => {
  if (value === null || value === undefined) return null
  if (typeof value === "string") return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (value instanceof Date) return value.getTime()
  if (
    typeof value === "object" &&
    value !== null &&
    "toMillis" in value &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis()
  }
  return null
}

// ============================================================================
// Permission Types
// ============================================================================

export const MEMBERSHIP_ROLES = ["owner", "admin", "member", "guest"] as const

export type IMembershipRole = (typeof MEMBERSHIP_ROLES)[number]
export type NodeType = "folder" | "file"
export type WorkspaceNodeScope = "code" | "write"

export type Scope = "global" | "team" | "workspace"

export const Capabilities = {
  // Global Scope
  CREATE_TEAM: "create_team",

  // Team Scope
  EDIT_TEAM: "edit_team",
  DELETE_TEAM: "delete_team",
  INVITE_MEMBER: "invite_member",
  UPDATE_MEMBER_ROLE: "update_member_role",
  REMOVE_MEMBER: "remove_member",
  READ_TEAM: "read_team",
  MANAGE_BILLING: "manage_billing",
  READ_AUDIT_LOGS: "read_audit_logs",

  // Workspace Scope
  CREATE_WORKSPACE: "create_workspace",
  EDIT_WORKSPACE: "edit_workspace",
  DELETE_WORKSPACE: "delete_workspace",
  READ_WORKSPACE: "read_workspace",
  MANAGE_WORKSPACE_CONTENT: "manage_workspace_content",
} as const

export type Capability = (typeof Capabilities)[keyof typeof Capabilities]

export interface PermissionContext {
  scope: Scope
  teamRole?: IMembershipRole | null
}

// ============================================================================
// Team Types
// ============================================================================

export const MembershipRoles = {
  OWNER: "owner" as IMembershipRole,
  ADMIN: "admin" as IMembershipRole,
  MEMBER: "member" as IMembershipRole,
  GUEST: "guest" as IMembershipRole,
} as const

export function isMembershipRole(value: unknown): value is IMembershipRole {
  return (
    typeof value === "string" &&
    (MEMBERSHIP_ROLES as readonly string[]).includes(value)
  )
}

export function normalizeMembershipRole(
  value: unknown,
  fallback: IMembershipRole = MembershipRoles.MEMBER
): IMembershipRole {
  return isMembershipRole(value) ? value : fallback
}

export const MembershipRoleLabels: Record<IMembershipRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  guest: "Guest",
}

export const RoleGroups = {
  /** Owners and admins - users with administrative capabilities */
  ADMINS: [MembershipRoles.OWNER, MembershipRoles.ADMIN],
  /** All full members (excludes guests) */
  MEMBERS: [
    MembershipRoles.OWNER,
    MembershipRoles.ADMIN,
    MembershipRoles.MEMBER,
  ],
  /** Everyone including guests */
  ALL: [
    MembershipRoles.OWNER,
    MembershipRoles.ADMIN,
    MembershipRoles.MEMBER,
    MembershipRoles.GUEST,
  ],
} as const

export interface TeamMember {
  userId: string
  email?: string
  role: IMembershipRole
}

// ============================================================================
// Notifier Types
// ============================================================================

export interface NotificationPayload {
  /** Target user's UID */
  userId: string
  /** Target user's email (required for email channel) */
  userEmail?: string
  /** Type of notification - determines which channels are used */
  type: NotificationType
  /** Notification title */
  title: string
  /** Notification description/body */
  description: string
  /** URL to navigate to when notification is clicked */
  url: string
  /** Optional source entity information */
  source?: {
    entityType: string
    entityId: string
  }
  /** Optional email-specific data (overrides for email channel) */
  emailData?: {
    /** Custom email subject (defaults to title) */
    subject?: string
    /** Custom template name (defaults to notification type) */
    template?: string
    /** Additional template data */
    templateData?: Record<string, unknown>
  }
}

// ============================================================================
// Audit Log Types
// ============================================================================

export type LogResourceType = "team" | "workspace" | "content" | "membership"

export interface Actor {
  userId: string
  email?: string
  role?: string
}

export interface Resource {
  type: LogResourceType
  id: string
  parentId?: string
}

export interface Context {
  ip?: string
  userAgent?: string
  authType?: "password" | "sso" | "api"
}

export interface Changes {
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  fields?: string[]
}

export interface LogEntry {
  id: string
  timestamp: admin.firestore.FieldValue | admin.firestore.Timestamp
  teamId: string
  workspaceId?: string
  actor: Actor
  action: string
  resource: Resource
  context?: Context
  changes?: Changes
}

export interface LogEventParams {
  teamId: string
  workspaceId?: string
  actor: Actor
  action: string
  resource: Resource
  context?: Context
  changes?: Changes
}
