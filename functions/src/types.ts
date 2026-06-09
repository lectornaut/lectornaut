import type { FieldValue, Timestamp } from "firebase-admin/firestore"

import type {
  Actor,
  AuditAction,
  Changes,
  Context,
  NotificationStatus,
  NotificationType,
  Resource,
} from "./domain.js"
import type { IMembershipRole } from "./permissions.js"

// ============================================================================
// Domain Vocabulary — re-exported from the @lectornaut/shared workspace package
// (via the ./domain.js shim, the single cross-platform source of truth). This
// keeps `./types` the one import surface for functions code: callers that did
// `import { NotificationType, Actor, normalizeComparable } from "./types.js"`
// keep working while the definitions live in `shared/domain.ts`.
// ============================================================================

export * from "./domain.js"
/** `WorkspaceNodeScope` is the functions-side name for the shared `NodeScope`. */
export type { NodeScope as WorkspaceNodeScope } from "./domain.js"

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

// ============================================================================
// Notifier Documents (Firebase-typed — compose the shared vocabulary)
// ============================================================================

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
  createdAt: FieldValue
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
  createdAt: Timestamp | FieldValue
  resentAt?: Timestamp | FieldValue
}

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
// Sync (server-side)
// ============================================================================

/**
 * Server-side per-operation ack status. Deliberately distinct from the client's
 * sync *queue lifecycle* (`pending | sent | acked | rejected` in
 * `src/schemas/sync.ts`) — these are different state machines, not drift, so
 * the shared module hoists only the agreeing `SyncMutationType`, not this.
 */
export type SyncOperationStatus = "pending" | "ack" | "reject"

// ============================================================================
// Team Types
// ============================================================================

export interface TeamMember {
  userId: string
  email?: string
  role: IMembershipRole
}

// ============================================================================
// Audit Log Documents (Firebase-typed — compose the shared Actor/Resource/etc.)
// ============================================================================

export interface LogEntry {
  id: string
  timestamp: FieldValue | Timestamp
  teamId: string
  workspaceId?: string
  actor: Actor
  action: AuditAction
  resource: Resource
  context?: Context
  changes?: Changes
}

export interface LogEventParams {
  teamId: string
  workspaceId?: string
  actor: Actor
  action: AuditAction
  resource: Resource
  context?: Context
  changes?: Changes
}
