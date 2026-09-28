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
  "notification.digest",
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
  "notification.digest": {
    inApp: true,
    email: false,
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
  "connection",
  "integration",
  "workflow",
  "session",
  "billing",
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
  // The team-wide agent config at teams/{t}/settings/agent — system prompt,
  // model, and which side-effecting tools the bot may call. Admin-only, and it
  // changes what the AI will do for EVERY member, so it audits like any other
  // team-scoped capability change.
  "team.agent_config.update",
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
  // Self-service account erasure. Written once per team the user belonged to,
  // so each team's log shows the member's account going away. Deliberately
  // carries NO email/username/displayName — see `deleteCurrentUserAccountData`.
  "membership.account.delete",
  // User-scoped identity changes, fanned into each team the user belongs to —
  // same shape as `membership.account.delete`. These are what a teammate SEES
  // (display name, handle, public profile), so the team whose log they land in
  // is the audience that can act on an impersonation attempt. Deliberately NOT
  // extended to device sessions: see `sessions.ts`.
  "membership.profile.update",
  "membership.username.claim",
  "membership.username.release",
  "membership.visibility.update",
  // group
  "group.create",
  "group.update",
  "group.delete",
  "group.grant.update",
  // memory
  "memory.create",
  "memory.update",
  "memory.delete",
  "memory.archive",
  "memory.unarchive",
  "memory.archiveAll",
  "memory.archivePrivate",
  "memory.share",
  "memory.unshare",
  "memory.merge",
  "memory.purge",
  "memory.purgePrivate",
  // invitation
  "invitation.create",
  "invitation.resend",
  "invitation.update",
  "invitation.delete",
  "invitation.decline",
  // The join itself — the invitation doc is DELETED on acceptance, so this
  // entry is the only surviving link between the invited email and the uid
  // that consumed it (carried in `changes.after.invitationId`).
  "invitation.accept",
  // connection (team-level app lifecycle + per-member account bindings;
  // resource id == provider key, e.g. "google-calendar")
  "connection.install",
  "connection.uninstall",
  "connection.enable",
  "connection.disable",
  "connection.binding.create",
  "connection.binding.delete",
  // integration (agent/tool lifecycle in teams/{t}/integrations; resource id
  // == doc id — catalog sourceKey for built-ins, auto-id for customs)
  "integration.create",
  "integration.update",
  "integration.install",
  "integration.uninstall",
  "integration.enable",
  "integration.disable",
  "integration.delete",
  // workflow (per-workspace automations + the team-tier preset availability;
  // run.* audit the human decisions on run history, not executions)
  "workflow.create",
  "workflow.update",
  "workflow.enable",
  "workflow.disable",
  "workflow.archive",
  "workflow.unarchive",
  "workflow.delete",
  "workflow.availability.update",
  "workflow.run.review",
  "workflow.run.delete",
  // Firing a workflow off-schedule — the human decision behind an otherwise
  // autonomous agent run.
  "workflow.run.start",
  // bot session (chat) — only the two acts an ADMIN may perform on another
  // member's session are audited; owner-only cosmetics (rename/archive/pin)
  // are not.
  "session.visibility.update",
  "session.delete",
  // billing (team-scoped, Stripe-backed). `portal.open` records no state change
  // of its own: it is the door through which a member makes changes INSIDE
  // Stripe, which return as webhook-driven mutations with no human attached —
  // this entry is the only thing tying those back to a person.
  "billing.checkout.start",
  "billing.portal.open",
  "billing.plan.change",
  "billing.cancel",
  "billing.restore",
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
  "blocked", // over budget — no spend
  "skipped", // workflow disabled or removed before it ran
] as const
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number]

// ============================================================================
// Agents & Bot Sessions
// ============================================================================

/** Model provider families the bot/agent layer can call. */
export const AI_PROVIDERS = [
  "google",
  "anthropic",
  "openai",
  "xai",
  "deepseek",
] as const
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
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
  "gemini-3.6-flash",
  "gemini-3.1-pro-preview",
  // Anthropic Claude
  "claude-haiku-4-5",
  "claude-opus-4-1",
  "claude-sonnet-4-5",
  "claude-fable-5",
  "claude-opus-5",
  "claude-sonnet-5",
  // OpenAI
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5.6",
  // xAI Grok
  "grok-4",
  "grok-4-fast-reasoning",
  "grok-4.5",
  // DeepSeek
  "deepseek-chat",
  "deepseek-reasoner",
  "deepseek-v4-flash",
  "deepseek-v4-pro",
] as const
export type BotAgentModel = (typeof BOT_AGENT_MODELS)[number]

/** Default turn-handling mode for an agent. */
export const BOT_CHAT_MODES = ["auto", "agent", "manual"] as const
export type BotChatMode = (typeof BOT_CHAT_MODES)[number]

/**
 * Per-turn reasoning-effort levels the composer can request. A canonical
 * ordinal scale mapped per provider at dispatch (`buildTurnConfig`):
 * Anthropic `effort`, Gemini 3 `thinkingConfig.thinkingLevel`. Unset/null
 * means "provider default" — the wire field is optional so legacy clients
 * that never send it behave exactly as before the knob existed.
 */
export const BOT_CHAT_EFFORTS = ["low", "medium", "high"] as const
export type BotChatEffort = (typeof BOT_CHAT_EFFORTS)[number]

/** Flat client-facing role denormalized onto a stored session message. */
export const BOT_CHAT_ROLES = ["user", "agent"] as const
export type BotChatRole = (typeof BOT_CHAT_ROLES)[number]

/**
 * Optional per-message status on a stored agent message. `"error"` marks a
 * turn that ended in a server-side graceful fallback (turn deadline, tool
 * budget exhausted, missing tool, invalid tool args) — persisted so the
 * failure survives reload and renders distinctly from a normal reply. The
 * field is optional on the wire: absent on every normal message, never set
 * on user messages, and ignored by clients that pre-date it.
 */
export const BOT_CHAT_MESSAGE_STATUSES = ["error"] as const
export type BotChatMessageStatus = (typeof BOT_CHAT_MESSAGE_STATUSES)[number]

export const BOT_SESSION_VISIBILITIES = ["private", "shared", "public"] as const
export type BotSessionVisibility = (typeof BOT_SESSION_VISIBILITIES)[number]

// ============================================================================
// Memory
// ============================================================================

/**
 * Per-memory privacy boundary. Copied verbatim from `botSessions`'
 * private/shared semantics (deliberately NOT the three-way
 * {@link BOT_SESSION_VISIBILITIES} — memory has no `"public"` mode): a memory
 * is readable by its `ownerUid`, by anyone in the workspace once `"shared"`,
 * and — for the management UI only — by team admins. A missing value is
 * treated as `"private"` everywhere (the rules check `== "shared"`, so absence
 * is already the safe default), but the create callable still writes it.
 */
export const MEMORY_VISIBILITY = ["private", "shared"] as const
export type MemoryVisibility = (typeof MEMORY_VISIBILITY)[number]

/** Coarse taxonomy for a memory — drives list facets and recall hints. */
export const MEMORY_CATEGORIES = [
  "fact",
  "preference",
  "context",
  "reference",
  "conversation",
] as const
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number]

/**
 * How a memory came to exist. `"agent"` is a memory an agent wrote on behalf
 * of the acting user (still owned by that user) — it is a field, not a scope.
 */
export const MEMORY_SOURCES = [
  "user",
  "agent",
  "chat",
  "document",
  "workflow",
  "import",
] as const
export type MemorySource = (typeof MEMORY_SOURCES)[number]

/**
 * Embedding dimension for memory vectors. MUST equal `NODE_EMBEDDING_DIM` in
 * `functions/src/botRag.ts` — read- and write-side vectors share the single
 * `NODE_EMBEDDER`, so the index, the indexer dim-guard, and the retriever all
 * agree on this number. Changing it requires rebuilding the vector index.
 */
export const MEMORY_DIM = 768

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
// Connections (installable apps backed by external accounts)
// ============================================================================
// See docs/connections-feature.prompt.md. A connection is the team-scoped
// credentialed link to an external provider (doc id == provider key at
// teams/{teamId}/connections/{provider}); the capabilities it contributes are
// ordinary integration docs with the reserved `source: "published"`.

export const CONNECTION_PROVIDERS = [
  "google-calendar",
  "google-drive",
  "google-gmail",
  "github",
] as const
export type ConnectionProvider = (typeof CONNECTION_PROVIDERS)[number]

/**
 * Provider-level lifecycle. `disabled` is the Owner/Admin team-wide kill
 * switch: bindings and contributed integration docs stay intact, but the
 * server stops registering the app's tools, refuses to mint binding access
 * tokens, and rejects new connects until re-enabled. Absent field = active
 * (pre-kill-switch docs).
 */
export const CONNECTION_STATUSES = ["active", "disabled"] as const
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number]

/**
 * Per-member account-link health. `needs_reauth` is set server-side when a
 * token refresh comes back `invalid_grant`; reconnecting re-runs the same
 * OAuth popup and flips it back to `connected`.
 */
export const CONNECTION_BINDING_STATUSES = [
  "connected",
  "needs_reauth",
] as const
export type ConnectionBindingStatus =
  (typeof CONNECTION_BINDING_STATUSES)[number]

/**
 * Wire-names of connection-contributed tools (integration `sourceKey`s with
 * `source: "published"`). NOT members of `IBotAgentToolToggles` / the slash
 * menu catalog (memory-tools precedent): they're gated by the integration
 * doc's installed+enabled state plus a per-user binding at call time, never
 * by a per-agent toggle (P1).
 */
export const GOOGLE_CALENDAR_TOOL_KEY = "googleCalendar"
export const GOOGLE_DRIVE_TOOL_KEY = "googleDrive"
export const GOOGLE_GMAIL_TOOL_KEY = "googleGmail"
export const GITHUB_TOOL_KEY = "gitHub"
export const CONNECTION_TOOL_KEYS = [
  GOOGLE_CALENDAR_TOOL_KEY,
  GOOGLE_DRIVE_TOOL_KEY,
  GOOGLE_GMAIL_TOOL_KEY,
  GITHUB_TOOL_KEY,
] as const
export type ConnectionToolKey = (typeof CONNECTION_TOOL_KEYS)[number]

/**
 * Companion read tool to `googleDrive` (content fetch). NOT a sourceKey —
 * no integration doc of its own; it rides the googleDrive doc's install +
 * enable gate, the same one-gate-per-app rule as the calendar write tools.
 */
export const GOOGLE_DRIVE_READ_FILE_TOOL_NAME = "readDriveFile"

/**
 * Companion read tool to `gitHub` (file/dir content fetch) — rides the one
 * gitHub install gate, like `readDriveFile` does for googleDrive.
 */
export const GITHUB_READ_FILE_TOOL_NAME = "readGitHubFile"

/**
 * Companion read tool to `googleGmail` (message-body fetch) — rides the one
 * googleGmail install gate, like `readDriveFile` does for googleDrive.
 */
export const GOOGLE_GMAIL_READ_MESSAGE_TOOL_NAME = "readGmailMessage"

/**
 * Genkit wire-names of each app's confirm-gated WRITE tools (no integration
 * docs — they ride the app's one install gate). Shared because three
 * consumers must agree on the exact strings: the server's resume-flow
 * dispatch + live-stream interrupt marking (connectionTools.ts / bot.ts),
 * the client's confirm-card branch (BotChatToolCall.vue — previously a
 * hardcoded keep-in-sync mirror), and the custom-tool wire-name collision
 * guard (connectionProviders.ts → assertWireNameUnique).
 */
export const GOOGLE_CALENDAR_WRITE_TOOL_NAMES = [
  "createCalendarEvent",
  "updateCalendarEvent",
] as const
/**
 * Drive D2 write tools — reserved in the collision guard from D1 so a team
 * can't create a custom tool that collides the day the write tools land
 * (which would force a rename-or-reinstall migration).
 */
export const GOOGLE_DRIVE_WRITE_TOOL_NAMES = [
  "createDriveFile",
  "updateDriveFile",
] as const
/**
 * GitHub confirm-gated write tools (P2). `addGitHubComment` covers issues AND
 * pull requests (PRs are issues for the comment API).
 */
export const GITHUB_WRITE_TOOL_NAMES = [
  "createGitHubIssue",
  "addGitHubComment",
  "updateGitHubIssue",
] as const
/**
 * Gmail confirm-gated write tools — ONE verb: send (covers new mail AND
 * in-thread replies via `replyToMessageId`). No draft/modify tools — each
 * would drag in another restricted scope for marginal value.
 */
export const GOOGLE_GMAIL_WRITE_TOOL_NAMES = ["sendGmailMessage"] as const

/**
 * Union of EVERY connection provider's write-tool wire-names — the single
 * source the bot's interrupt-marking + resume-flow dispatch key on, so a new
 * provider's writes are recognized at all those sites by extending this list
 * alone (the resume site is fail-closed: an unrecognized write-interrupt
 * hard-rejects the member's Approve/Cancel click).
 */
export const CONNECTION_WRITE_TOOL_NAMES: readonly string[] = [
  ...GOOGLE_CALENDAR_WRITE_TOOL_NAMES,
  ...GOOGLE_DRIVE_WRITE_TOOL_NAMES,
  ...GITHUB_WRITE_TOOL_NAMES,
  ...GOOGLE_GMAIL_WRITE_TOOL_NAMES,
]

// ── OAuth scope hierarchy ───────────────────────────────────────────────────
// Shared so the server's write gate (`hasGrantedScope` in connectionTools)
// and the client's "reconnect for new permissions" hint
// (`needsScopeUpgrade` in useConnections) agree: a broader grant satisfies a
// narrower requirement, so a `calendar` grant must NOT be flagged as missing
// `calendar.events`.

export const GOOGLE_CALENDAR_FULL_SCOPE =
  "https://www.googleapis.com/auth/calendar"
export const GOOGLE_CALENDAR_EVENTS_SCOPE =
  "https://www.googleapis.com/auth/calendar.events"
export const GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.readonly"

export const GOOGLE_DRIVE_FULL_SCOPE = "https://www.googleapis.com/auth/drive"
export const GOOGLE_DRIVE_READONLY_SCOPE =
  "https://www.googleapis.com/auth/drive.readonly"
export const GOOGLE_DRIVE_FILE_SCOPE =
  "https://www.googleapis.com/auth/drive.file"

/** Gmail's full-mailbox scope — never requested; satisfier-only. */
export const GOOGLE_MAIL_FULL_SCOPE = "https://mail.google.com/"
export const GOOGLE_GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly"
export const GOOGLE_GMAIL_SEND_SCOPE =
  "https://www.googleapis.com/auth/gmail.send"

// GitHub is a GitHub App, not an OAuth App: access is governed by the app's
// granted PERMISSIONS + installed repos, not OAuth scopes — so it has no scope
// constants and requests no `scope`.

/** Granted scopes (key) that satisfy a required scope (value). */
const SCOPE_SATISFIERS: Readonly<Record<string, readonly string[]>> = {
  [GOOGLE_CALENDAR_EVENTS_SCOPE]: [
    GOOGLE_CALENDAR_EVENTS_SCOPE,
    GOOGLE_CALENDAR_FULL_SCOPE,
  ],
  [GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE]: [
    GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE,
    GOOGLE_CALENDAR_EVENTS_SCOPE,
    GOOGLE_CALENDAR_FULL_SCOPE,
  ],
  // Drive's two chains are PARALLEL: `drive.file` (read+write, but only
  // files the app created or the user picked) and `drive.readonly` (read
  // EVERYTHING) don't satisfy each other; only full `drive` tops both.
  [GOOGLE_DRIVE_READONLY_SCOPE]: [
    GOOGLE_DRIVE_READONLY_SCOPE,
    GOOGLE_DRIVE_FULL_SCOPE,
  ],
  [GOOGLE_DRIVE_FILE_SCOPE]: [GOOGLE_DRIVE_FILE_SCOPE, GOOGLE_DRIVE_FULL_SCOPE],
  [GOOGLE_GMAIL_READONLY_SCOPE]: [
    GOOGLE_GMAIL_READONLY_SCOPE,
    GOOGLE_MAIL_FULL_SCOPE,
  ],
  [GOOGLE_GMAIL_SEND_SCOPE]: [GOOGLE_GMAIL_SEND_SCOPE, GOOGLE_MAIL_FULL_SCOPE],
  // GitHub needs no rows — a GitHub App requests no scopes; access is governed
  // by its installed-repo permissions, gated at the API (403/404), not here.
}

/**
 * Whether `granted` includes a scope that satisfies `required` (exact match
 * or anything broader up the hierarchy). Unknown requirements fall back to
 * exact match.
 */
export function hasGrantedScope(
  granted: readonly string[] | undefined,
  required: string
): boolean {
  const satisfiers = SCOPE_SATISFIERS[required] ?? [required]
  return (granted ?? []).some((scope) => satisfiers.includes(scope))
}

// ============================================================================
// Attachments (upload + server-side import gates)
// ============================================================================
// One source for the limits THREE enforcement points must agree on: the
// client upload helpers (`src/helpers/node-attachments.ts`), the server-side
// Drive import (`functions/src/nodeAttachments.ts` — the admin SDK bypasses
// storage.rules, so the server re-applies these), and storage.rules itself
// (rules can't import TS — its copy stays manual; update it when these
// change).

export const NODE_ATTACHMENT_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

/** Types that could execute in a browser if served from storage URLs. */
const BLOCKED_ATTACHMENT_MIME_PATTERNS: readonly RegExp[] = [
  /^text\/html$/i,
  /^application\/xhtml.*/i,
  /^image\/svg.*/i,
  /^application\/x-shockwave-flash$/i,
  /^text\/javascript$/i,
  /^application\/javascript$/i,
]

export const isBlockedAttachmentMimeType = (
  mimeType: string | null | undefined
): boolean => {
  if (!mimeType) return false
  const normalized = mimeType.trim().toLowerCase()
  return BLOCKED_ATTACHMENT_MIME_PATTERNS.some((pattern) =>
    pattern.test(normalized)
  )
}

// The server labels each chat-turn attachment with one of these text parts
// (`functions/src/botMedia.ts`), which the history extractor flattens into
// the user message's `content` — so persisted user turns carry the marker
// inline. Chat surfaces parse it back out to render attachment chips
// instead of raw `[Uploaded file …]` prose. Builder and parser sit together
// here so the two sides can never drift.
export const buildUploadedFileLabel = (name: string): string =>
  `[Uploaded file "${name}"]`

// Lazy (`.+?`) so a display name containing quotes still parses — the match
// ends at the first `"]`, which normalized single-line names can't contain.
const UPLOADED_FILE_LABEL_RE = /\[Uploaded file "(.+?)"\]/g

/** Split a user turn's content into the typed text + labeled file names. */
export const splitUploadedFileLabels = (
  content: string
): { text: string; attachments: string[] } => {
  const attachments: string[] = []
  const text = content
    .replace(UPLOADED_FILE_LABEL_RE, (_match, name: string) => {
      attachments.push(name)
      return ""
    })
    .trim()
  return { text, attachments }
}

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

/**
 * Monthly LLM token allowance per plan, in TOTAL tokens (input + output)
 * across every agent turn a team runs in a calendar month — interactive chat
 * AND autonomous Workflows runs draw from the same pool. Enforced as a HARD
 * CAP by `assertWithinBudget` (functions/usageMetering.ts) and rendered by
 * Settings → Usage on the client. `-1` = unlimited.
 */
export const PLAN_TOKEN_ALLOWANCES: Record<BillingPlanKey, number> = {
  personal: 1_500_000,
  professional: 25_000_000,
  business: 150_000_000,
  enterprise: -1,
}

/**
 * Workspaces per team, per plan. `-1` = unlimited. Enforced inside the
 * `createWorkspace` transaction (functions/audit.ts) against a live count, and
 * advertised on Settings → Plans and the pricing page from this same table.
 */
export const PLAN_WORKSPACE_ALLOWANCES: Record<BillingPlanKey, number> = {
  personal: 1,
  professional: 5,
  business: 20,
  enterprise: -1,
}

/** Workspace allowance for a plan; missing/unknown plan → the lowest plan. */
export function getPlanWorkspaceAllowance(
  planKey: string | null | undefined
): number {
  return (
    PLAN_WORKSPACE_ALLOWANCES[planKey as BillingPlanKey] ??
    PLAN_WORKSPACE_ALLOWANCES.personal
  )
}

/**
 * Audit-log retention per plan, in days. `-1` = unlimited. Enforced by the
 * daily `cleanupAuditLogs` sweep (functions/audit.ts) against each team's
 * LIVE plan — so an upgrade keeps everything still on disk, and a downgrade
 * trims to the new window on the next sweep. The client query hides older
 * rows immediately (useAuditLogs). Export is an Enterprise capability.
 */
export const PLAN_AUDIT_LOG_RETENTION_DAYS: Record<BillingPlanKey, number> = {
  personal: 30,
  professional: 90,
  business: 365,
  enterprise: -1,
}

/** Retention for a plan in days; missing/unknown plan → the lowest plan. */
export function getPlanAuditLogRetentionDays(
  planKey: string | null | undefined
): number {
  return (
    PLAN_AUDIT_LOG_RETENTION_DAYS[planKey as BillingPlanKey] ??
    PLAN_AUDIT_LOG_RETENTION_DAYS.personal
  )
}

/** Oldest timestamp still retained, or `null` when retention is unlimited. */
export function auditLogRetentionCutoff(
  planKey: string | null | undefined,
  now: Date = new Date()
): Date | null {
  const days = getPlanAuditLogRetentionDays(planKey)
  if (days < 0) return null
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

/** Plans that may export audit logs. Only Enterprise today. */
export function canExportAuditLogsOnPlan(
  planKey: string | null | undefined
): boolean {
  return planKey === "enterprise"
}

/**
 * Plan fit: what a team must FIX before it may move to `plan`. Pure and shared
 * so the Plans page and the plan-change callables can never disagree. Only
 * remediable, hard-gated facts block:
 *   - workspaces  → delete down to the plan's allowance (createWorkspace gate)
 *   - sso         → turn SSO off (Enterprise-only, functions/sso.ts)
 * Non-remediable effects (this month's token usage, shorter audit-log
 * retention, a default model outside the plan) auto-resolve on the server and
 * are surfaced as warnings, never blockers.
 */
export interface PlanFitSnapshot {
  workspaceCount: number
  ssoEnabled: boolean
}
export type PlanFitBlocker =
  { kind: "workspaces"; count: number; allowance: number } | { kind: "sso" }

export function getPlanFitBlockers(
  plan: BillingPlanKey,
  snapshot: PlanFitSnapshot
): PlanFitBlocker[] {
  const blockers: PlanFitBlocker[] = []
  const allowance = PLAN_WORKSPACE_ALLOWANCES[plan]
  if (allowance >= 0 && snapshot.workspaceCount > allowance) {
    blockers.push({
      kind: "workspaces",
      count: snapshot.workspaceCount,
      allowance,
    })
  }
  if (snapshot.ssoEnabled && plan !== "enterprise") {
    blockers.push({ kind: "sso" })
  }
  return blockers
}

/** Bounds for the team-set monthly token cap (Settings → Usage). */
export const MONTHLY_TOKEN_CAP_MIN = 10_000

/** Minimum team-set monthly estimated-cost cap, in USD cents. */
export const MONTHLY_COST_CAP_MIN_CENTS = 100

/**
 * Model tier: the LOWEST plan that may use each model; higher plans inherit.
 * The single source for the server's effective-config policy
 * (functions/botAgentConfig.ts), the AI settings + composer pickers, and the
 * plan copy on Settings → Plans and the pricing page. Every model in
 * `BOT_AGENT_MODELS` must have an entry (the Record type enforces it).
 */
export const MODEL_MIN_PLAN: Record<BotAgentModel, BillingPlanKey> = {
  "gemini-2.5-flash-lite": "personal",
  "gemini-2.5-pro": "professional",
  "gemini-3.6-flash": "personal",
  "deepseek-v4-flash": "personal",
  "deepseek-chat": "personal",
  "deepseek-reasoner": "professional",
  "gemini-3.1-pro-preview": "professional",
  "claude-haiku-4-5": "personal",
  "claude-opus-4-1": "business",
  "claude-sonnet-4-5": "professional",
  "claude-sonnet-5": "professional",
  "deepseek-v4-pro": "professional",
  "claude-opus-5": "business",
  "gpt-5-nano": "personal",
  "gpt-5-mini": "professional",
  "gpt-5": "business",
  "gpt-5.6": "business",
  "grok-4": "business",
  "grok-4-fast-reasoning": "professional",
  "grok-4.5": "business",
  "claude-fable-5": "enterprise",
}

/**
 * The model every plan can always fall back to. Its provider (Google) is the
 * one the server always has configured — embeddings and web grounding need it
 * — so a turn can never be left with no resolvable model.
 */
export const PLAN_FLOOR_MODEL: BotAgentModel = "gemini-3.6-flash"

/** Rank of a plan in `BILLING_PLAN_KEYS`; unknown/missing → the lowest plan. */
function planRankOrLowest(planKey: string | null | undefined): number {
  const rank = BILLING_PLAN_KEYS.indexOf(planKey as BillingPlanKey)
  return rank < 0 ? 0 : rank
}

/** Whether `model` is included in `planKey` (missing/unknown plan → lowest). */
export function isModelAllowedOnPlan(
  model: BotAgentModel,
  planKey: string | null | undefined
): boolean {
  return planRankOrLowest(MODEL_MIN_PLAN[model]) <= planRankOrLowest(planKey)
}

/** Models a plan includes, in catalog order. */
export function modelsForPlan(
  planKey: string | null | undefined
): BotAgentModel[] {
  return BOT_AGENT_MODELS.filter((m) => isModelAllowedOnPlan(m, planKey))
}

/** Models a plan adds over the plan directly below it (all of them for the lowest). */
export function modelsAddedByPlan(planKey: BillingPlanKey): BotAgentModel[] {
  return BOT_AGENT_MODELS.filter((m) => MODEL_MIN_PLAN[m] === planKey)
}

/**
 * Effective monthly allowance = the plan allowance, lowered by the team's own
 * cap when one is set. A team cap can never RAISE the plan allowance. `-1`
 * (unlimited) only survives when no team cap is set.
 */
export function resolveEffectiveTokenAllowance(
  planAllowance: number,
  teamCap: unknown
): number {
  const cap =
    typeof teamCap === "number" && Number.isFinite(teamCap) && teamCap > 0
      ? Math.floor(teamCap)
      : null
  if (cap === null) return planAllowance
  if (planAllowance < 0) return cap
  return Math.min(planAllowance, cap)
}
