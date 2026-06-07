import admin from "firebase-admin"
import type { IMembershipRole } from "./permissions.js"

// Notification Channel Types
export type NotificationChannel = "inApp" | "email" | "native"
export type NotificationCategory = "communication" | "marketing" | "security"
export type NotificationFrequency = "immediate" | "daily" | "weekly" | "none"

export interface ChannelConfig {
  inApp: boolean
  email: boolean
  native: boolean
  category: NotificationCategory
}

export type NotificationStatus = "inbox" | "saved" | "done"
export type NotificationType =
  | "user.welcome"
  | "notification.test"
  | "invitation.received"
  | "invitation.declined"
  | "member.joined"
  | "member.removed"
  | "workflow.run"

export interface NotificationCategorySettings {
  communication: boolean
  marketing: boolean
  security: boolean
}

export interface NotificationChannelSettings {
  email: boolean
  inApp: boolean
  native: boolean
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
    native: true,
  },
}

// Default channel configuration for each notification type
export const NotificationTypeConfig: Record<NotificationType, ChannelConfig> = {
  "user.welcome": {
    inApp: true,
    email: true,
    native: false,
    category: "marketing",
  },
  "notification.test": {
    inApp: true,
    email: true,
    native: true,
    category: "communication",
  },
  "invitation.received": {
    inApp: true,
    email: true,
    native: true,
    category: "communication",
  },
  "invitation.declined": {
    inApp: true,
    email: false,
    native: false,
    category: "communication",
  },
  "member.joined": {
    inApp: true,
    email: false,
    native: false,
    category: "communication",
  },
  "member.removed": {
    inApp: true,
    email: true,
    native: true,
    category: "security",
  },
  // Workflow run completions worth a human's attention (awaiting review,
  // error, blocked). `communication` so users can mute it; `native: false`
  // keeps errors/blocked from popping desktop alerts.
  "workflow.run": {
    inApp: true,
    email: true,
    native: false,
    category: "communication",
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
// Permission & Role Types — re-exported via the local permissions shim, which
// in turn re-exports from shared/permissions.ts (the single source of truth).
// ============================================================================

export {
  Capabilities,
  hasExactRole,
  isMembershipRole,
  MEMBERSHIP_ROLES,
  MembershipRoleLabels,
  MembershipRoles,
  normalizeMembershipRole,
  roleCan,
  RoleGroups,
  type Capability,
  type IMembershipRole,
  type PermissionContext,
  type Scope,
} from "./permissions.js"

// Types that are only used in functions (not shared with client)
export type NodeType = "folder" | "file"
export type WorkspaceNodeScope = "code" | "write"

// ============================================================================
// Team Types
// ============================================================================

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

export type LogResourceType =
  | "team"
  | "workspace"
  | "content"
  | "membership"
  | "group"
  | "security"

export interface Actor {
  /**
   * The human who drove the action. Optional: a headless Workflows run has no
   * human, so an autonomous agent edit carries only `agentId`/`agentName` and
   * omits `userId`. An interactive (or agent-on-user's-behalf) action always
   * sets it.
   */
  userId?: string
  email?: string
  role?: string
  /**
   * Set when an agent member performed the action. For an interactive turn
   * `userId` identifies the driving human and these identify the agent that
   * executed it; for an autonomous Workflows run there is no `userId` and
   * these are the sole actor identity.
   */
  agentId?: string
  agentName?: string
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
