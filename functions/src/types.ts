import admin from "firebase-admin"

// Notification Channel Types
export type NotificationChannel = "in-app" | "email"

export interface ChannelConfig {
  inApp: boolean
  email: boolean
}

export type NotificationStatus = "inbox" | "saved" | "done"
export type NotificationType =
  | "user.welcome"
  | "invitation.received"
  | "invitation.declined"
  | "member.joined"
  | "member.removed"

// Default channel configuration for each notification type
export const NotificationTypeConfig: Record<NotificationType, ChannelConfig> = {
  "user.welcome": { inApp: true, email: true },
  "invitation.received": { inApp: true, email: true },
  "invitation.declined": { inApp: true, email: true },
  "member.joined": { inApp: true, email: true },
  "member.removed": { inApp: true, email: true },
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

export interface NotificationPreferences {
  enabled: boolean
  mutedTypes: string[]
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
// Permission Types
// ============================================================================

export type IMembershipRole = "owner" | "admin" | "member" | "guest"
export type NodeType = "folder" | "file"

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
