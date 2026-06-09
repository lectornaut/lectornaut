/**
 * Shared Domain Vocabulary
 *
 * The single source of truth for the platform-agnostic *vocabulary* of the
 * domain — the enum member sets, the config-constant records, the pure helper
 * functions, and the plain interfaces that describe Nodes, Notifications, Audit
 * logs, and Sync. Both the client (src/) and Cloud Functions (functions/)
 * consume this file, so — exactly like `permissions.ts` — keep it free of any
 * platform-specific import (no Firebase, no Vue, no Zod).
 *
 * Client: imported via the `@lectornaut/shared/domain` package export; the
 *   client's Zod schemas derive their enums from the `as const` arrays here
 *   (`z.enum(NODE_SCOPES)`), so the schema and the vocabulary never drift.
 * Functions: imported through the one-line `functions/src/domain.ts` shim;
 *   esbuild inlines this module into the deploy bundle.
 *
 * The boundary rule: a value belongs here only if it is identical on both
 * sides. Anything that carries a platform type — a Firestore `Timestamp` /
 * `FieldValue`, a Vue ref — stays in that platform's own schema/interface and
 * *composes* the vocabulary below (see `LogEntry` in functions/src/types.ts,
 * which keeps its `FieldValue` timestamp but imports `Actor`/`Resource` here).
 */

// ============================================================================
// Workspace Nodes
// ============================================================================

export const NODE_TYPES = ["folder", "file"] as const
export type NodeType = (typeof NODE_TYPES)[number]

export const NODE_SCOPES = ["code", "write"] as const
/** The two document trees a workspace node can live in. */
export type NodeScope = (typeof NODE_SCOPES)[number]

// ============================================================================
// Notifications
// ============================================================================

export const NOTIFICATION_CHANNELS = ["inApp", "email", "native"] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

export const NOTIFICATION_CATEGORIES = [
  "communication",
  "marketing",
  "security",
] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

export const NOTIFICATION_FREQUENCIES = [
  "immediate",
  "daily",
  "weekly",
  "none",
] as const
export type NotificationFrequency = (typeof NOTIFICATION_FREQUENCIES)[number]

export const NOTIFICATION_STATUSES = ["inbox", "saved", "done"] as const
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number]

export const NOTIFICATION_TYPES = [
  "user.welcome",
  "notification.test",
  "invitation.received",
  "invitation.declined",
  "member.joined",
  "member.removed",
  "workflow.run",
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

/** Which channels a notification type fires on, and how a user may mute it. */
export interface ChannelConfig {
  inApp: boolean
  email: boolean
  native: boolean
  category: NotificationCategory
}

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

/**
 * Default channel configuration for each notification type. Typed with
 * `satisfies Record<NotificationType, ChannelConfig>` (rather than annotated)
 * so a notification type added to {@link NOTIFICATION_TYPES} without a matching
 * entry here is a *compile error*, not a silent runtime gap.
 */
export const NotificationTypeConfig = {
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
} satisfies Record<NotificationType, ChannelConfig>

// ============================================================================
// Audit Log
// ============================================================================

export const LOG_RESOURCE_TYPES = [
  "team",
  "workspace",
  "content",
  "membership",
  "group",
  "security",
] as const
export type LogResourceType = (typeof LOG_RESOURCE_TYPES)[number]

/**
 * Every audited action string (the `action` field of a log entry). The client
 * builds its `logActionSchema` z.enum from this; the server types `LogEntry` /
 * `LogEventParams.action` against the derived `AuditAction`, so a typo'd action
 * at a `logEvent(...)` callsite becomes a compile error instead of a silent
 * unvalidated string.
 */
export const AUDIT_ACTIONS = [
  // team
  "team.create",
  "team.update",
  "team.delete",
  // workspace
  "workspace.create",
  "workspace.update",
  "workspace.delete",
  // content
  "content.create",
  "content.rename",
  "content.move",
  "content.archive",
  "content.unarchive",
  "content.delete",
  "content.update",
  // content attachments
  "content.attachment.create",
  "content.attachment.rename",
  "content.attachment.update",
  "content.attachment.delete",
  // membership
  "membership.role.update",
  "membership.workspace_role.update",
  "membership.leave",
  "membership.remove",
  "membership.agent.add",
  "membership.agent.remove",
  // group
  "group.create",
  "group.update",
  "group.delete",
  "group.grant.update",
  // invitation
  "invitation.create",
  "invitation.resend",
  "invitation.update",
  "invitation.delete",
  "invitation.decline",
  // security
  "sso.configured",
  "sso.deleted",
  "security.login_methods.updated",
  "security.approved_domains.updated",
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const AUTH_TYPES = ["password", "sso", "api"] as const
export type AuthType = (typeof AUTH_TYPES)[number]

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
  authType?: AuthType
}

export interface Changes {
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  fields?: string[]
}

// ============================================================================
// Sync
// ============================================================================

export const SYNC_MUTATION_TYPES = ["set", "update", "delete"] as const
export type SyncMutationType = (typeof SYNC_MUTATION_TYPES)[number]

export interface SyncBaseVersion {
  field: string
  value: number | string | null
}

/**
 * Normalize a Firestore field value into a comparable primitive. Handles
 * Timestamps (duck-typed via `toMillis`, so no Firebase import is needed),
 * Dates, numbers, and strings. Used for base-version comparison in sync
 * operations on both the client and the server.
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
// Workflows
// ============================================================================

export const WORKFLOW_UPDATE_MODES = ["automatic", "require_review"] as const
export type WorkflowUpdateMode = (typeof WORKFLOW_UPDATE_MODES)[number]

export const WORKFLOW_RUN_STATUSES = [
  "queued",
  "running",
  "success", // automatic run that applied its edits directly
  "awaiting_review", // require_review run: changes captured, pending approval
  "applied", // require_review run: approved + applied
  "partially_applied", // require_review run: approved, some changes failed
  "cancelled", // require_review run: rejected by an admin
  "error",
  "blocked", // over budget / not entitled — no spend
  "skipped", // workflow disabled or removed before it ran
] as const
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number]

// ============================================================================
// Agents & Bot Sessions
// ============================================================================

/** Model provider families the bot/agent layer can call. */
export const AI_PROVIDERS = ["google", "anthropic", "openai"] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]

/**
 * Wire-name allowlist of every chat model the agent layer may dispatch to. The
 * client's `botAgentModelSchema` derives its `z.enum` from this; the server's
 * `BOT_AGENT_MODEL_REGISTRY` pairs each id with a provider and is constrained
 * (`satisfies`) to these ids. Wire-name prefixes are load-bearing — the server's
 * `resolveModel()` dispatches by `gemini-*` / `claude-*` / `gpt-*`.
 */
export const BOT_AGENT_MODELS = [
  // Google Gemini
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  // Anthropic Claude
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  // OpenAI
  "gpt-5",
] as const
export type BotAgentModel = (typeof BOT_AGENT_MODELS)[number]

/** Default turn-handling mode for an agent. */
export const BOT_CHAT_MODES = ["auto", "agent", "manual"] as const
export type BotChatMode = (typeof BOT_CHAT_MODES)[number]

/** Flat client-facing role denormalized onto a stored session message. */
export const BOT_CHAT_ROLES = ["user", "agent"] as const
export type BotChatRole = (typeof BOT_CHAT_ROLES)[number]

export const BOT_SESSION_VISIBILITIES = ["private", "shared", "public"] as const
export type BotSessionVisibility = (typeof BOT_SESSION_VISIBILITIES)[number]

// ============================================================================
// Integrations
// ============================================================================

/**
 * Catalog taxonomy. Keeps `"workflow"` even though a stored integration doc is
 * only `agent | tool` — workflows live in their own collection; catalog code
 * still classifies all three.
 */
export const INTEGRATION_TYPES = ["agent", "tool", "workflow"] as const
export type IntegrationType = (typeof INTEGRATION_TYPES)[number]

export const INTEGRATION_SOURCES = ["builtin", "custom", "published"] as const
export type IntegrationSource = (typeof INTEGRATION_SOURCES)[number]

// ============================================================================
// Billing
// ============================================================================

export const BILLING_PLAN_KEYS = [
  "personal",
  "professional",
  "business",
  "enterprise",
] as const
export type BillingPlanKey = (typeof BILLING_PLAN_KEYS)[number]

export const BILLING_INTERVALS = ["month", "year"] as const
export type BillingInterval = (typeof BILLING_INTERVALS)[number]
