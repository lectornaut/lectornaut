/**
 * Cloud Functions Composable
 *
 * Provides typed wrappers for Firebase Cloud Functions with audit logging.
 * All mutations should go through these functions to ensure audit trails.
 */

import { functions } from "@/modules/firebase"
import type {
  BillingInterval,
  BillingPlanKey,
  IAgentIntegrationDraft,
  IAgentIntegrationPatch,
  IBotAgentConfig,
  IBotAgentModel,
  IBotAgentToolToggles,
  IBotSessionVisibility,
  ICustomToolAction,
  IIntegration,
  ITeamAgent,
  ITeamBilling,
  ITeamCustomTool,
  IToolIntegrationDraft,
  IToolIntegrationPatch,
} from "@/types/domain"
import type { IMembershipRole } from "@/types/membership"
import type { WorkspaceNodeScope } from "@/types/nodes"
import type { INotificationStatus } from "@/types/notification"
import type {
  MemoryCategory,
  MemoryVisibility,
} from "@lectornaut/shared/domain"
import {
  httpsCallable,
  type HttpsCallable,
  type HttpsCallableResult,
} from "firebase/functions"

export type { BillingInterval, BillingPlanKey } from "@/types/domain"

// =============================================================================
// Team Request/Response Types
// =============================================================================

export interface CreateTeamRequest {
  name: string
  photoURL?: string | null
}

export interface CreateTeamResponse {
  teamId: string
}

export interface UpdateTeamRequest {
  teamId: string
  name?: string
  photoURL?: string | null
  username?: string | null
  isPublic?: boolean
}

export interface UpdateTeamResponse {
  teamId: string
  updated: boolean
  fields?: string[]
  logId?: string
}

export interface DeleteTeamRequest {
  teamId: string
}

export interface DeleteTeamResponse {
  teamId: string
  deleted: boolean
}

// =============================================================================
// Workspace Request/Response Types
// =============================================================================

export interface CreateWorkspaceRequest {
  teamId: string
  name: string
  description?: string | null
}

export interface CreateWorkspaceResponse {
  workspaceId: string
  logId: string
}

export interface UpdateWorkspaceRequest {
  teamId: string
  workspaceId: string
  name?: string
  description?: string | null
  photoURL?: string | null
}

export interface UpdateWorkspaceResponse {
  workspaceId: string
  updated: boolean
  fields?: string[]
  logId?: string
}

export interface DeleteWorkspaceRequest {
  teamId: string
  workspaceId: string
}

export interface DeleteWorkspaceResponse {
  workspaceId: string
  deleted: boolean
  logId: string
}

// =============================================================================
// Workspace Node Request/Response Types
// =============================================================================

export interface CreateWorkspaceNodeRequest {
  scope: WorkspaceNodeScope
  teamId: string
  workspaceId: string
  parentId: string
  name: string
  type: "folder" | "file"
}

export interface CreateWorkspaceNodeResponse {
  nodeId: string
  logId: string
}

export interface RenameWorkspaceNodeRequest {
  scope: WorkspaceNodeScope
  teamId: string
  workspaceId: string
  nodeId: string
  name: string
}

export interface RenameWorkspaceNodeResponse {
  nodeId: string
  updated: boolean
  logId: string
}

export interface MoveWorkspaceNodeRequest {
  scope: WorkspaceNodeScope
  teamId: string
  workspaceId: string
  nodeId: string
  parentId: string
}

export interface MoveWorkspaceNodeResponse {
  nodeId: string
  updated: boolean
  logId: string
}

export interface ArchiveWorkspaceNodeRequest {
  scope: WorkspaceNodeScope
  teamId: string
  workspaceId: string
  nodeId: string
}

export interface ArchiveWorkspaceNodeResponse {
  nodeId: string
  archived: boolean
  logId: string
}

export interface UnarchiveWorkspaceNodeRequest {
  scope: WorkspaceNodeScope
  teamId: string
  workspaceId: string
  nodeId: string
}

export interface UnarchiveWorkspaceNodeResponse {
  nodeId: string
  unarchived: boolean
  logId: string
}

export interface DeleteWorkspaceNodeRequest {
  scope: WorkspaceNodeScope
  teamId: string
  workspaceId: string
  nodeId: string
}

export interface DeleteWorkspaceNodeResponse {
  nodeId: string
  deleted: boolean
  deletedCount: number
  logId: string
}

export interface UpdateWorkspaceNodeContentRequest {
  scope: WorkspaceNodeScope
  teamId: string
  workspaceId: string
  nodeId: string
  content: string
}

export interface UpdateWorkspaceNodeContentResponse {
  nodeId: string
  updated: boolean
  logId: string
}

export interface CreateWorkspaceNodeAttachmentRequest {
  scope: WorkspaceNodeScope
  teamId: string
  workspaceId: string
  nodeId: string
  attachmentId: string
  displayName: string
  originalName: string
  storagePath: string
}

export interface CreateWorkspaceNodeAttachmentResponse {
  attachmentId: string
  created: boolean
  logId: string
}

export interface UpdateWorkspaceNodeAttachmentRequest {
  scope: WorkspaceNodeScope
  teamId: string
  workspaceId: string
  nodeId: string
  attachmentId: string
  displayName: string
  storagePath?: string
  originalName?: string
}

export interface UpdateWorkspaceNodeAttachmentResponse {
  attachmentId: string
  updated: boolean
  logId?: string
}

export interface DeleteWorkspaceNodeAttachmentRequest {
  scope: WorkspaceNodeScope
  teamId: string
  workspaceId: string
  nodeId: string
  attachmentId: string
}

export interface DeleteWorkspaceNodeAttachmentResponse {
  attachmentId: string
  deleted: boolean
  logId: string
}

export interface CreateBotSessionAttachmentRequest {
  teamId: string
  workspaceId: string
  sessionId: string
  attachmentId: string
  displayName: string
  originalName: string
  storagePath: string
}

export interface CreateBotSessionAttachmentResponse {
  attachmentId: string
  created: boolean
}

export interface UpdateBotSessionAttachmentRequest {
  teamId: string
  workspaceId: string
  sessionId: string
  attachmentId: string
  displayName: string
  storagePath?: string
  originalName?: string
}

export interface UpdateBotSessionAttachmentResponse {
  attachmentId: string
  updated: boolean
}

export interface DeleteBotSessionAttachmentRequest {
  teamId: string
  workspaceId: string
  sessionId: string
  attachmentId: string
}

export interface DeleteBotSessionAttachmentResponse {
  attachmentId: string
  deleted: boolean
}

// =============================================================================
// Membership Request/Response Types
// =============================================================================

export interface AssignRoleRequest {
  teamId: string
  userId: string
  role: IMembershipRole
}

export interface AssignRoleResponse {
  teamId: string
  userId: string
  role: string
  updated: boolean
  logId?: string
}

export interface AssignWorkspaceRoleRequest {
  teamId: string
  workspaceId: string
  userId: string
  /**
   * Partial patch. Omit to leave unchanged; `null` clears the role override;
   * a role sets it.
   */
  role?: IMembershipRole | null
  /**
   * Workspace participation. Omit to leave unchanged; `true` excludes the member
   * (a non-member of this workspace), `false` re-includes them. Enforced
   * everywhere: it drops the uid from `memberUids` (list query + read rule) and
   * denies all content read/write for the member; deny beats every elevation.
   */
  excluded?: boolean
}

export interface AssignWorkspaceRoleResponse {
  teamId: string
  workspaceId: string
  userId: string
  role: IMembershipRole | null
  excluded: boolean
  updated: boolean
  logId?: string
}

export interface ListWorkspaceMemberRolesRequest {
  teamId: string
  workspaceId: string
}

export interface WorkspaceMemberRole {
  userId: string
  /** Explicit per-workspace role override, or null when none is set. */
  role: IMembershipRole | null
  /** True = excluded (a non-member of this workspace); access is denied. */
  excluded: boolean
}

export interface ListWorkspaceMemberRolesResponse {
  teamId: string
  workspaceId: string
  /** Only members with a stored override (a role and/or an `excluded` flag). */
  roles: WorkspaceMemberRole[]
}

// =============================================================================
// Group Request/Response Types
// =============================================================================

export interface CreateGroupRequest {
  teamId: string
  name: string
  /** Optional free-text description; empty/omitted is stored as null. */
  description?: string | null
  /** Human team-member uids; agents/unknown ids are dropped server-side. */
  memberIds?: string[]
}

export interface CreateGroupResponse {
  teamId: string
  groupId: string
  created: boolean
  logId?: string
}

export interface UpdateGroupRequest {
  teamId: string
  groupId: string
  /** Omit to leave unchanged. */
  name?: string
  /** Omit to leave unchanged; `null` clears the description; a string sets it. */
  description?: string | null
  /** Omit to leave unchanged; otherwise replaces the member set. */
  memberIds?: string[]
  /** Omit to leave unchanged; `null` clears the avatar; a string sets it. */
  photoURL?: string | null
}

export interface UpdateGroupResponse {
  teamId: string
  groupId: string
  updated: boolean
  logId?: string
}

export interface DeleteGroupRequest {
  teamId: string
  groupId: string
}

export interface DeleteGroupResponse {
  teamId: string
  groupId: string
  deleted: boolean
  logId?: string
}

export interface AssignWorkspaceGroupRoleRequest {
  teamId: string
  workspaceId: string
  groupId: string
  /** A role grants/updates; `null` removes the grant. */
  role: IMembershipRole | null
}

export interface AssignWorkspaceGroupRoleResponse {
  teamId: string
  workspaceId: string
  groupId: string
  role: IMembershipRole | null
  updated: boolean
  logId?: string
}

export interface ListWorkspaceGroupRolesRequest {
  teamId: string
  workspaceId: string
}

export interface WorkspaceGroupGrant {
  groupId: string
  role: IMembershipRole
}

export interface ListWorkspaceGroupRolesResponse {
  teamId: string
  workspaceId: string
  /** Only groups granted a role in this workspace. */
  grants: WorkspaceGroupGrant[]
}

export interface GetTeamGroupUsageRequest {
  teamId: string
}

export interface GetTeamGroupUsageResponse {
  teamId: string
  /** Per-group count of workspaces that grant it a role. */
  usage: Record<string, number>
}

export interface RemoveMemberRequest {
  teamId: string
  userId: string
}

export interface RemoveMemberResponse {
  teamId: string
  userId: string
  removed: boolean
  logId: string
}

export interface RemoveMembersRequest {
  teamId: string
  userIds: string[]
}

export interface RemoveMembersResponse {
  teamId: string
  userIds: string[]
  removed: boolean
  count: number
  logIds: string[]
}

export interface AddTeamAgentMemberRequest {
  teamId: string
  agentId: string
}

export interface AddTeamAgentMemberResponse {
  teamId: string
  agentId: string
  role: string
  added: boolean
  logId?: string
}

export interface RemoveTeamAgentMemberRequest {
  teamId: string
  agentId: string
}

export interface RemoveTeamAgentMemberResponse {
  teamId: string
  agentId: string
  removed: boolean
  logId?: string
}

// =============================================================================
// Invitation Request/Response Types
// =============================================================================

export interface SendInvitationRequest {
  teamId: string
  email: string
  role: IMembershipRole
}

export interface SendInvitationResponse {
  invitationId: string
}

export interface ResendInvitationRequest {
  invitationId: string
}

export interface ResendInvitationResponse {
  success: boolean
}

export interface UpdateInvitationRoleRequest {
  invitationId: string
  role: IMembershipRole
}

export interface UpdateInvitationRoleResponse {
  updated: boolean
}

export interface CancelInvitationRequest {
  invitationId: string
}

export interface CancelInvitationResponse {
  deleted: boolean
}

export interface DeclineInvitationRequest {
  invitationId: string
}

export interface DeclineInvitationResponse {
  declined: boolean
}

// =============================================================================
// Billing Request/Response Types
// =============================================================================

export type BillingStatusData = ITeamBilling

export interface CreateCheckoutSessionRequest {
  teamId: string
  planKey: BillingPlanKey
  interval: BillingInterval
}

export interface CreateCheckoutSessionResponse {
  url: string
}

export interface CreateBillingPortalSessionRequest {
  teamId: string
}

export interface CreateBillingPortalSessionResponse {
  url: string
}

export interface ChangeSubscriptionPlanRequest {
  teamId: string
  targetPlanKey: BillingPlanKey
  targetInterval: BillingInterval
  timing?: "immediate" | "period_end"
}

export interface BillingSummaryResponse {
  status: string | null
  currentPeriodEnd: number | null
  cancelAtPeriodEnd: boolean
  priceId: string | null
  quantity: number | null
}

export interface CancelSubscriptionRequest {
  teamId: string
  when?: "period_end"
}

export interface RestoreSubscriptionRequest {
  teamId: string
}

export interface GetBillingStatusRequest {
  teamId: string
}

export interface GetBillingStatusResponse {
  billing: BillingStatusData
}

export interface BillingCatalogPrice {
  priceId: string
  unitAmount: number | null
  currency: string | null
}

export type BillingCatalog = Record<
  BillingPlanKey,
  Record<BillingInterval, BillingCatalogPrice>
>

export type GetBillingCatalogRequest = Record<string, never>

export interface GetBillingCatalogResponse {
  prices: BillingCatalog
}

// =============================================================================
// Test Notification Types
// =============================================================================

export interface SendTestNotificationRequest {
  channel: "email" | "inApp" | "native"
}

export interface SendTestNotificationResponse {
  success: boolean
  channel: string
}

// =============================================================================
// Notification Mutation Request/Response Types
// =============================================================================

/**
 * Shared shape for the `markAllNotifications*` and `deleteAllNotifications`
 * batch callables. Omitting `status` operates over the whole inbox+saved+done
 * set; passing one narrows to that bucket. The server caps batch size to
 * `COST_BUDGET.QUERY_MAX_LIMIT`, so `count` may be lower than what the
 * client sees if the user has more notifications than the cap.
 */
export interface BatchNotificationRequest {
  status?: INotificationStatus
}

export interface BatchNotificationResponse {
  count: number
}

export interface DeleteNotificationRequest {
  notificationId: string
}

export interface DeleteNotificationResponse {
  success: boolean
}

// =============================================================================
// Public Profile Functions
// =============================================================================

export interface PublicProfileMember {
  userId: string
  displayName: string
  photoURL: string | null
}

export interface PublicProfileTeam {
  teamId: string
  name: string
  photoURL: string | null
}

export interface GetPublicTeamsForUserRequest {
  userId: string
}

export interface GetPublicTeamsForUserResponse {
  teams: PublicProfileTeam[]
  teamCount: number
}

export interface GetPublicTeamMembersRequest {
  teamId: string
}

export interface GetPublicTeamMembersResponse {
  members: PublicProfileMember[]
  memberCount: number
}

export type PublicAgentProfileStatus = "active" | "disabled" | "archived"

export interface PublicAgentProfile {
  /** The agent's uid — immutable, doubles as its public handle. */
  id: string
  name: string
  description: string
  avatarSeed: string
  isBuiltIn: boolean
  status: PublicAgentProfileStatus
  /**
   * EFFECTIVE public reachability — `team.isPublic && agent.isPublic` —
   * i.e. whether an anonymous viewer can open this profile. Members of
   * private teams (who get "found" via the membership gate) see `false`.
   */
  isPublic: boolean
  /** Membership `createdAt` — when the agent was added as a team member. */
  memberSinceMillis: number | null
  /** Agent doc `createdAt` (null for built-ins — no doc). */
  createdAtMillis: number | null
}

export interface PublicAgentProfileTeam extends PublicProfileTeam {
  username: string | null
}

export interface GetPublicAgentProfileRequest {
  agentId: string
}

export type GetPublicAgentProfileResponse =
  | {
      status: "found"
      agent: PublicAgentProfile
      team: PublicAgentProfileTeam | null
    }
  | { status: "private" }
  | { status: "not_found" }

// =============================================================================
// Bot Chat Request/Response Types
// =============================================================================

/**
 * Action-context mode for a chat turn. Mirrors the server enum; the
 * authoritative list lives in `functions/src/bot.ts` (`BOT_CHAT_MODES`).
 *   - `auto`   — balanced default; concise replies
 *   - `agent`  — proactive; thorough, narrated chain-of-thought
 *   - `manual` — discussion-first; uses tools only when explicitly asked
 * All tools are available in every mode; modes differ only in reply style.
 */
export type BotChatMode = "auto" | "agent" | "manual"

/**
 * Pointer to a workspace node attached to a chat turn. Mirrors the
 * `NodeRefSchema` on the server. Both `contextNodes` (per-turn ground
 * truth) and `pinnedNode` (one-shot session bind) use this shape.
 */
export interface BotChatNodeRef {
  scope: WorkspaceNodeScope
  nodeId: string
}

/**
 * One client-uploaded-but-uncommitted chat attachment — the brand-new-chat
 * single-send upload path. The blob is already in Storage (uploaded to the
 * client-minted `sessionId`'s path); the server writes the metadata doc on
 * receipt, re-reading the authoritative content-type/size.
 */
export interface BotSessionPendingAttachment {
  attachmentId: string
  storagePath: string
  displayName: string
  originalName: string
}

export interface SendBotMessageRequest {
  teamId: string
  workspaceId: string
  /** Pass null/undefined to start a new session; the response carries the new id. */
  sessionId?: string | null
  message: string
  /**
   * Per-turn capability mode. Optional — server defaults to `auto` when
   * omitted, so older clients that predate the mode selector still work.
   */
  mode?: BotChatMode
  /**
   * Per-turn model override. Optional — server falls back to the team's
   * admin-configured default when omitted, and silently substitutes the
   * default if the requested model isn't currently allowed by the team's
   * provider/model toggles. The server persists the *effective* model
   * (i.e. after that allowlist clamp) as `lastModel` on the session
   * doc, so the next client load rehydrates with the actually-used
   * model rather than a value the team policy would now reject.
   */
  model?: IBotAgentModel
  /**
   * Workspace nodes the user attached for this turn. The server fetches
   * each node's content + attachment list and injects them into the
   * system prompt as ground-truth context. Capped at 10 nodes server-
   * side; over the cap the call is rejected.
   */
  contextNodes?: BotChatNodeRef[]
  /**
   * When provided AND `sessionId` is null/omitted, the newly-created
   * session is pinned to this node so a future
   * `findBotSessionByPinnedNode` call resumes the same chat. Used by
   * the node inspector's Bot tab. Ignored on resumed sessions.
   */
  pinnedNode?: BotChatNodeRef
  /**
   * Custom agent the composer / sidebar has currently selected for
   * this turn. `null` (or omitted) means "use the team default
   * persona". Server semantics:
   *   - real id → that agent's persona handles the turn AND the new
   *     id is persisted on the session doc (sticks across sends).
   *   - null    → explicitly clear; the doc's `activeAgentId` is
   *     reset to null and subsequent turns use the team default.
   *   - omitted → leave the doc untouched and fall back to the
   *     session's prior `activeAgentId` if any. Use this from
   *     legacy clients that don't know about agents.
   * The server falls back to the default if the id points to a
   * since-archived agent — the field on the doc stays unchanged so
   * restoring the agent re-binds the session automatically.
   */
  activeAgentId?: string | null
  /**
   * Chat-session attachment ids the user selected to include as media on this
   * turn (per-turn selectable). Resolved server-side to base64 media parts;
   * empty/omitted sends no uploads.
   */
  attachmentIds?: string[]
  /**
   * Files uploaded to Storage for THIS turn whose metadata docs don't exist
   * yet — the brand-new-chat single-send path. The client mints `sessionId`,
   * uploads each blob to `botSessions/{sessionId}/…`, and passes the refs here;
   * the server writes the attachment docs (re-reading authoritative
   * content-type/size) and includes them as media this turn. Existing-session
   * uploads use the `createBotSessionAttachment` callable + `attachmentIds`.
   */
  pendingAttachments?: BotSessionPendingAttachment[]
  /**
   * Google Drive file ids to import + attach on THIS turn. The client can't
   * stage Drive bytes (only the server holds the OAuth token), so it passes
   * the ids and the server fetches Google→Functions→Storage, then includes
   * them as media — so a Drive file rides the brand-new-chat first message
   * exactly like a direct upload. Existing-session imports use the
   * `importDriveSessionAttachment` callable instead.
   */
  pendingDriveImports?: string[]
}

export interface SendBotMessageResponse {
  sessionId: string
  reply: string
}

export type BotChatRole = "user" | "agent"

/**
 * One slice of an agent message. Either a text run or a tool invocation.
 * Tool segments capture the model's reasoning loop so the UI can render
 * each call as a distinct card alongside surrounding text.
 */
export type BotChatHistorySegment =
  | { kind: "text"; text: string }
  | {
      kind: "tool"
      tool: {
        ref?: string
        name: string
        input?: unknown
        output?: unknown
        /**
         * When true, this tool call paused the chat for a Human-in-the-
         * Loop response. The renderer draws an interactive form; the
         * flag is dropped once `output` is set.
         */
        isInterrupt?: boolean
      }
    }

export interface BotChatHistoryMessage {
  role: BotChatRole
  content: string
  /** Present on agent messages with tool calls; absent for plain text. */
  segments?: BotChatHistorySegment[]
}

/**
 * One streamed update from `sendBotMessage`. Any combination of fields
 * may be present; the client routes by which ones are set:
 *   - `sessionId` — pinned once on the very first chunk
 *   - `chunk`     — a text delta from the model
 *   - `toolCall`  — model invoked a tool (input is finalised; output
 *                   arrives later as a matching `toolResult` keyed by
 *                   `ref`)
 *   - `toolResult` — tool returned `output`; client flips the matching
 *                   tool card from "running" to "done"
 */
export interface SendBotMessageStreamChunk {
  sessionId?: string
  chunk?: string
  toolCall?: {
    ref?: string
    name: string
    input?: unknown
    /**
     * When true, this tool call is a paused Human-in-the-Loop interrupt.
     * The chat is suspended server-side; the client must call
     * `respondToBotInterrupt` with the user's answer to resume it.
     */
    isInterrupt?: boolean
  }
  toolResult?: {
    ref?: string
    name: string
    output?: unknown
  }
}

/**
 * Resume a chat that was paused by an interrupt-tool call. Carries the
 * user's answer (matching the interrupt's `outputSchema`) plus the
 * (sessionId, ref, name) tuple identifying which interrupt is being
 * answered. Streams chunks back using the same `SendBotMessageStreamChunk`
 * protocol as `sendBotMessage`, so the client can route them through the
 * same pipeline.
 */
export interface RespondToBotInterruptRequest {
  teamId: string
  workspaceId: string
  sessionId: string
  ref?: string
  name: string
  /** Must conform to the interrupt tool's outputSchema. */
  response: unknown
  mode?: BotChatMode
  /**
   * Per-turn model override. Same semantics as
   * `SendBotMessageRequest.model` — server falls back to the team
   * default if the requested model is no longer allowed.
   */
  model?: IBotAgentModel
  /**
   * Forwarded to the resumed turn's system prompt so the model still
   * sees attached files after picking up from an interrupt. Same shape
   * as `SendBotMessageRequest.contextNodes`.
   */
  contextNodes?: BotChatNodeRef[]
  /**
   * Custom agent the composer has currently selected. Same semantics
   * as `SendBotMessageRequest.activeAgentId` — usually omitted on the
   * interrupt-response path so the session's persisted agent sticks,
   * but the client can override (e.g. user switched agents in the
   * composer between asking and answering).
   */
  activeAgentId?: string | null
}

export interface RespondToBotInterruptResponse {
  sessionId: string
  reply: string
}

export interface LoadBotSessionRequest {
  teamId: string
  workspaceId: string
  sessionId: string
}

export interface LoadBotSessionResponse {
  sessionId: string
  messages: BotChatHistoryMessage[]
}

export interface FindBotSessionByPinnedNodeRequest {
  teamId: string
  workspaceId: string
  scope: WorkspaceNodeScope
  nodeId: string
}

export interface FindBotSessionByPinnedNodeResponse {
  /** `null` when no session is pinned to this node for the caller yet. */
  sessionId: string | null
}

export interface UpdateBotSessionVisibilityRequest {
  teamId: string
  workspaceId: string
  sessionId: string
  visibility: IBotSessionVisibility
}

export interface UpdateBotSessionVisibilityResponse {
  sessionId: string
  visibility: IBotSessionVisibility
}

export interface RenameBotSessionRequest {
  teamId: string
  workspaceId: string
  sessionId: string
  title: string
}

export interface RenameBotSessionResponse {
  sessionId: string
  title: string
}

export interface ArchiveBotSessionRequest {
  teamId: string
  workspaceId: string
  sessionId: string
  archived: boolean
}

export interface ArchiveBotSessionResponse {
  sessionId: string
  archived: boolean
}

export interface DeleteBotSessionRequest {
  teamId: string
  workspaceId: string
  sessionId: string
}

export interface DeleteBotSessionResponse {
  sessionId: string
  deleted: true
}

// =============================================================================
// Team Agent Config Request/Response Types
// =============================================================================

export interface GetTeamAgentConfigRequest {
  teamId: string
}

export interface GetTeamAgentConfigResponse {
  config: IBotAgentConfig
  /** True when the team has an explicit overrides doc. */
  hasOverrides: boolean
}

/**
 * Partial update — only sent fields are written. Anything omitted falls
 * through to the previously-saved value (or to the server default if the
 * doc doesn't have it yet).
 */
export type UpdateTeamAgentConfigPatch = Partial<{
  providers: Partial<IBotAgentConfig["providers"]>
  models: Partial<IBotAgentConfig["models"]>
  model: IBotAgentConfig["model"]
  temperature: number
  topP: number
  topK: number
  maxOutputTokens: number
  thinking: boolean
  autoContext: boolean
  defaultMode: IBotAgentConfig["defaultMode"]
  systemPromptBase: string
  promptSuffixes: Partial<IBotAgentConfig["promptSuffixes"]>
  tools: Partial<IBotAgentConfig["tools"]>
  titleMaxLength: number
  previewMaxLength: number
}>

export interface UpdateTeamAgentConfigRequest {
  teamId: string
  updates: UpdateTeamAgentConfigPatch
}

export interface UpdateTeamAgentConfigResponse {
  config: IBotAgentConfig
}

// =============================================================================
// Team Agent editor draft types
// =============================================================================
// Agent CRUD now flows through the unified `integration*` callables
// (createIntegration / updateIntegration / setIntegrationEnabled /
// installIntegration / uninstallIntegration / deleteIntegration). These two
// draft/patch shapes remain the agent editor's view-model; teamAgentsStore /
// useTeamAgents map them onto the unified integration payloads.

/**
 * Creation payload for an agent. `name` and `systemPromptBase` are required
 * because the agent can't function without them. Everything else defaults
 * server-side (empty strings for text, all-true for tools).
 *
 * Tools is partial — the server fills missing keys with `true`, so an
 * older client that doesn't know about a newly-added tool still creates
 * an agent that has access to it.
 */
export interface CreateTeamAgentDraft {
  name: string
  description?: string
  avatarSeed?: string
  /**
   * Public-profile visibility. Effective only when the team is public —
   * team privacy is the outer boundary. Omitted = true.
   */
  isPublic?: boolean
  systemPromptBase: string
  promptSuffixes?: Partial<ITeamAgent["promptSuffixes"]>
  tools?: Partial<IBotAgentToolToggles>
  /**
   * Per-custom-tool overrides — keyed by `ITeamCustomTool.id`. Missing
   * keys default to enabled at dispatch time, so an empty `{}` (or
   * omitting the field entirely) means "every custom tool is
   * available to this agent." Listing a key with `false` overrides
   * that single tool. The agent editor sends the full set of known
   * ids on save so a removed-from-form id reverts to the default,
   * not to its prior `false` value.
   */
  customTools?: Record<string, boolean>
}

/**
 * Update payload — every field optional. Only sent fields are written;
 * nested `promptSuffixes` and `tools` patches are merged server-side onto
 * the saved record so omitted keys keep their prior values. `enabled` rides
 * along for symmetry.
 */
export type UpdateTeamAgentPatch = Partial<CreateTeamAgentDraft> & {
  enabled?: boolean
}

// =============================================================================
// Team Custom Tool editor draft types
// =============================================================================
// Custom-tool CRUD now flows through the unified `integration*` callables.
// These draft/patch shapes remain the tool editor's view-model;
// teamCustomToolsStore / useTeamCustomTools map them onto the unified payloads.

/**
 * Creation payload for a custom tool. Required fields:
 *   - `name`        — wire-name. Must match `/^[a-z][a-zA-Z0-9_]*$/`.
 *   - `description` — the description the model sees.
 *   - `inputSchema` / `outputSchema` — field lists (may be empty).
 *   - `action`      — discriminated union with the implementation.
 *
 * `displayName` and `avatarSeed` default server-side when omitted.
 */
export interface CreateTeamCustomToolDraft {
  name: string
  displayName?: string
  description: string
  avatarSeed?: string
  inputSchema: ITeamCustomTool["inputSchema"]
  outputSchema: ITeamCustomTool["outputSchema"]
  action: ICustomToolAction
}

/**
 * Update payload — every field optional; only sent fields are written.
 * `enabled` rides along for symmetry.
 */
export type UpdateTeamCustomToolPatch = Partial<CreateTeamCustomToolDraft> & {
  enabled?: boolean
}

// =============================================================================
// User Profile Request/Response Types
// =============================================================================

export interface ClaimUsernameRequest {
  username: string
}

export interface ClaimUsernameResponse {
  username: string
}

export interface ReleaseUsernameRequest {
  username: string
}

export interface ReleaseUsernameResponse {
  released: boolean
}

export interface UpdateUserProfileVisibilityRequest {
  isPublic: boolean
}

export interface UpdateUserProfileVisibilityResponse {
  isPublic: boolean
}

/**
 * Self-edit of `displayName` and/or `photoURL` on the caller's own user
 * profile. Sibling of {@link claimUsername} (handles `username`) and
 * {@link updateUserProfileVisibility} (handles `isPublic`) — those
 * callables predate this one and remain canonical for their fields.
 *
 * Omit a key to leave that field untouched; pass `null` (or the empty
 * string, which the server normalizes to `null`) for `photoURL` to
 * clear it. `displayName` cannot be cleared — the settings UI always
 * provides one.
 *
 * The server updates Firestore AND Firebase Auth in one round-trip,
 * eliminating the divergence window the prior client-side parallel-
 * writes pattern had. The audit entry lands in Cloud Logging under
 * `action: "userProfile.update.self"` rather than the team-scoped
 * `logs` collection.
 */
export interface UpdateOwnUserProfileRequest {
  displayName?: string
  photoURL?: string | null
}

export interface UpdateOwnUserProfileResponse {
  updated: boolean
  /** Subset of {displayName, photoURL} whose value actually changed. */
  fields: string[]
}

export type SyncCurrentUserAccountProfileRequest = Record<string, never>

export interface SyncCurrentUserAccountProfileResponse {
  synced: boolean
}

export type DeleteCurrentUserAccountDataRequest = Record<string, never>

export interface DeleteCurrentUserAccountDataResponse {
  deleted: boolean
}

// =============================================================================
// Typed Function Callers
// =============================================================================

type FunctionCaller<TRequest, TResponse> = (
  data: TRequest
) => Promise<HttpsCallableResult<TResponse>>

function createTypedCallable<TRequest, TResponse>(
  name: string
): FunctionCaller<TRequest, TResponse> {
  const callable = httpsCallable<TRequest, TResponse>(functions, name)
  return (data: TRequest) => callable(data)
}

/**
 * Variant of {@link createTypedCallable} that exposes the underlying
 * `HttpsCallable` so callers can use both unary (`callable(data)`) and
 * streaming (`callable.stream(data)`) invocations against the same
 * endpoint. Used for `onCallGenkit` flows that emit chunks.
 */
function createTypedStreamingCallable<TRequest, TResponse, TStream>(
  name: string
): HttpsCallable<TRequest, TResponse, TStream> {
  return httpsCallable<TRequest, TResponse, TStream>(functions, name)
}

// =============================================================================
// Team Functions
// =============================================================================

/**
 * Create a new team with automatic audit logging.
 * Creates the team and owner membership in a single transaction.
 */
export const createTeam = createTypedCallable<
  CreateTeamRequest,
  CreateTeamResponse
>("createTeam")

/**
 * Update an existing team with automatic audit logging.
 * Only changed fields are logged.
 */
export const updateTeam = createTypedCallable<
  UpdateTeamRequest,
  UpdateTeamResponse
>("updateTeam")

/**
 * Delete a team with automatic audit logging.
 * Deletes all workspaces and memberships.
 */
export const deleteTeam = createTypedCallable<
  DeleteTeamRequest,
  DeleteTeamResponse
>("deleteTeam")

// =============================================================================
// Workspace Functions
// =============================================================================

/**
 * Create a new workspace with automatic audit logging.
 * Returns the new workspace ID and the audit log ID.
 */
export const createWorkspace = createTypedCallable<
  CreateWorkspaceRequest,
  CreateWorkspaceResponse
>("createWorkspace")

/**
 * Update an existing workspace with automatic audit logging.
 * Only changed fields are logged.
 */
export const updateWorkspace = createTypedCallable<
  UpdateWorkspaceRequest,
  UpdateWorkspaceResponse
>("updateWorkspace")

/**
 * Delete a workspace with automatic audit logging.
 * Logs the workspace data before deletion.
 */
export const deleteWorkspace = createTypedCallable<
  DeleteWorkspaceRequest,
  DeleteWorkspaceResponse
>("deleteWorkspace")

// =============================================================================
// Workspace Node Functions
// =============================================================================

export const createWorkspaceNode = createTypedCallable<
  CreateWorkspaceNodeRequest,
  CreateWorkspaceNodeResponse
>("createWorkspaceNode")

export const renameWorkspaceNode = createTypedCallable<
  RenameWorkspaceNodeRequest,
  RenameWorkspaceNodeResponse
>("renameWorkspaceNode")

export const moveWorkspaceNode = createTypedCallable<
  MoveWorkspaceNodeRequest,
  MoveWorkspaceNodeResponse
>("moveWorkspaceNode")

export const archiveWorkspaceNode = createTypedCallable<
  ArchiveWorkspaceNodeRequest,
  ArchiveWorkspaceNodeResponse
>("archiveWorkspaceNode")

export const unarchiveWorkspaceNode = createTypedCallable<
  UnarchiveWorkspaceNodeRequest,
  UnarchiveWorkspaceNodeResponse
>("unarchiveWorkspaceNode")

export const deleteWorkspaceNode = createTypedCallable<
  DeleteWorkspaceNodeRequest,
  DeleteWorkspaceNodeResponse
>("deleteWorkspaceNode")

export const updateWorkspaceNodeContent = createTypedCallable<
  UpdateWorkspaceNodeContentRequest,
  UpdateWorkspaceNodeContentResponse
>("updateWorkspaceNodeContent")

export const createWorkspaceNodeAttachment = createTypedCallable<
  CreateWorkspaceNodeAttachmentRequest,
  CreateWorkspaceNodeAttachmentResponse
>("createWorkspaceNodeAttachment")

export const updateWorkspaceNodeAttachment = createTypedCallable<
  UpdateWorkspaceNodeAttachmentRequest,
  UpdateWorkspaceNodeAttachmentResponse
>("updateWorkspaceNodeAttachment")

export const deleteWorkspaceNodeAttachment = createTypedCallable<
  DeleteWorkspaceNodeAttachmentRequest,
  DeleteWorkspaceNodeAttachmentResponse
>("deleteWorkspaceNodeAttachment")

export const createBotSessionAttachment = createTypedCallable<
  CreateBotSessionAttachmentRequest,
  CreateBotSessionAttachmentResponse
>("createBotSessionAttachment")

export const updateBotSessionAttachment = createTypedCallable<
  UpdateBotSessionAttachmentRequest,
  UpdateBotSessionAttachmentResponse
>("updateBotSessionAttachment")

export const deleteBotSessionAttachment = createTypedCallable<
  DeleteBotSessionAttachmentRequest,
  DeleteBotSessionAttachmentResponse
>("deleteBotSessionAttachment")

// =============================================================================
// Membership Functions
// =============================================================================

/**
 * Assign a role to a user with automatic audit logging.
 * Logs both the previous and new role.
 */
export const assignRoleToUser = createTypedCallable<
  AssignRoleRequest,
  AssignRoleResponse
>("assignRoleToUser")

/**
 * Grant (or clear, with `role: null`) a member's per-workspace role override.
 * Combines with their team role under elevate-only semantics
 * (`effectiveRole` in @lectornaut/shared/permissions), so it can only raise a
 * member's access within that one workspace. Audit-logged.
 */
export const assignWorkspaceRole = createTypedCallable<
  AssignWorkspaceRoleRequest,
  AssignWorkspaceRoleResponse
>("assignWorkspaceRole")

/**
 * List a workspace's per-workspace role overrides, keyed by member uid.
 * Admin-gated; powers the workspace role-assignment UI. Members without an
 * override are omitted (they inherit their team role).
 */
export const listWorkspaceMemberRoles = createTypedCallable<
  ListWorkspaceMemberRolesRequest,
  ListWorkspaceMemberRolesResponse
>("listWorkspaceMemberRoles")

// =============================================================================
// Group Functions
// =============================================================================

/**
 * Create a reusable group — a named bundle of human team members. Role-less:
 * the role a group confers is granted per-workspace via
 * {@link assignWorkspaceGroupRole}. Admin-gated; audit-logged.
 */
export const createGroup = createTypedCallable<
  CreateGroupRequest,
  CreateGroupResponse
>("createGroup")

/** Rename a group and/or replace its member set. Admin-gated; audit-logged. */
export const updateGroup = createTypedCallable<
  UpdateGroupRequest,
  UpdateGroupResponse
>("updateGroup")

/**
 * Delete a group, dropping every workspace grant that references it and
 * recomputing affected members' elevation. Admin-gated; audit-logged.
 */
export const deleteGroup = createTypedCallable<
  DeleteGroupRequest,
  DeleteGroupResponse
>("deleteGroup")

/**
 * Grant (or clear, with `role: null`) a group's elevate-only per-workspace
 * role. Mirrors {@link assignWorkspaceRole}: admin-gated, owner-only for the
 * `owner` role; audit-logged.
 */
export const assignWorkspaceGroupRole = createTypedCallable<
  AssignWorkspaceGroupRoleRequest,
  AssignWorkspaceGroupRoleResponse
>("assignWorkspaceGroupRole")

/**
 * List a workspace's group grants (`[{ groupId, role }]`). Admin-gated; powers
 * the WorkspaceDialog groups area.
 */
export const listWorkspaceGroupRoles = createTypedCallable<
  ListWorkspaceGroupRolesRequest,
  ListWorkspaceGroupRolesResponse
>("listWorkspaceGroupRoles")

/**
 * Per-group count of workspaces that grant it a role — the "used in N
 * workspaces" blast-radius cue. Admin-gated.
 */
export const getTeamGroupUsage = createTypedCallable<
  GetTeamGroupUsageRequest,
  GetTeamGroupUsageResponse
>("getTeamGroupUsage")

/**
 * Remove a single member from a team with automatic audit logging.
 * Can be used to leave a team (remove self) or remove others.
 */
export const removeMember = createTypedCallable<
  RemoveMemberRequest,
  RemoveMemberResponse
>("removeMember")

/**
 * Remove multiple members from a team with automatic audit logging.
 * Creates a log entry for each removed member.
 */
export const removeMembers = createTypedCallable<
  RemoveMembersRequest,
  RemoveMembersResponse
>("removeMembers")

/**
 * Add an agent (custom or built-in) to a team as a member. No invitation
 * handshake — the membership is written directly. Always role "member".
 */
export const addTeamAgentMember = createTypedCallable<
  AddTeamAgentMemberRequest,
  AddTeamAgentMemberResponse
>("addTeamAgentMember")

/**
 * Remove an agent membership from a team. Leaves the agent persona intact.
 */
export const removeTeamAgentMember = createTypedCallable<
  RemoveTeamAgentMemberRequest,
  RemoveTeamAgentMemberResponse
>("removeTeamAgentMember")

// =============================================================================
// Invitation Functions
// =============================================================================

export const sendInvitation = createTypedCallable<
  SendInvitationRequest,
  SendInvitationResponse
>("sendInvitation")

export const resendInvitation = createTypedCallable<
  ResendInvitationRequest,
  ResendInvitationResponse
>("resendInvitation")

export const updateInvitationRole = createTypedCallable<
  UpdateInvitationRoleRequest,
  UpdateInvitationRoleResponse
>("updateInvitationRole")

export const cancelInvitation = createTypedCallable<
  CancelInvitationRequest,
  CancelInvitationResponse
>("cancelInvitation")

export const declineInvitation = createTypedCallable<
  DeclineInvitationRequest,
  DeclineInvitationResponse
>("declineInvitation")

export const createCheckoutSession = createTypedCallable<
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse
>("createCheckoutSession")

export const createBillingPortalSession = createTypedCallable<
  CreateBillingPortalSessionRequest,
  CreateBillingPortalSessionResponse
>("createBillingPortalSession")

export const changeSubscriptionPlan = createTypedCallable<
  ChangeSubscriptionPlanRequest,
  BillingSummaryResponse
>("changeSubscriptionPlan")

export const cancelSubscription = createTypedCallable<
  CancelSubscriptionRequest,
  BillingSummaryResponse
>("cancelSubscription")

export const restoreSubscription = createTypedCallable<
  RestoreSubscriptionRequest,
  BillingSummaryResponse
>("restoreSubscription")

export const getBillingStatus = createTypedCallable<
  GetBillingStatusRequest,
  GetBillingStatusResponse
>("getBillingStatus")

export const getBillingCatalog = createTypedCallable<
  GetBillingCatalogRequest,
  GetBillingCatalogResponse
>("getBillingCatalogHttp")

export const sendTestNotification = createTypedCallable<
  SendTestNotificationRequest,
  SendTestNotificationResponse
>("sendTestNotification")

// =============================================================================
// Notification Mutation Functions
// =============================================================================

export const markAllNotificationsRead = createTypedCallable<
  BatchNotificationRequest,
  BatchNotificationResponse
>("markAllNotificationsRead")

export const markAllNotificationsUnread = createTypedCallable<
  BatchNotificationRequest,
  BatchNotificationResponse
>("markAllNotificationsUnread")

export const markAllNotificationsDone = createTypedCallable<
  BatchNotificationRequest,
  BatchNotificationResponse
>("markAllNotificationsDone")

export const markAllNotificationsInbox = createTypedCallable<
  BatchNotificationRequest,
  BatchNotificationResponse
>("markAllNotificationsInbox")

export const markAllNotificationsSaved = createTypedCallable<
  BatchNotificationRequest,
  BatchNotificationResponse
>("markAllNotificationsSaved")

export const deleteAllNotifications = createTypedCallable<
  BatchNotificationRequest,
  BatchNotificationResponse
>("deleteAllNotifications")

export const deleteNotification = createTypedCallable<
  DeleteNotificationRequest,
  DeleteNotificationResponse
>("deleteNotification")

export const getPublicTeamMembers = createTypedCallable<
  GetPublicTeamMembersRequest,
  GetPublicTeamMembersResponse
>("getPublicTeamMembers")

export const getPublicTeamsForUser = createTypedCallable<
  GetPublicTeamsForUserRequest,
  GetPublicTeamsForUserResponse
>("getPublicTeamsForUser")

export const getPublicAgentProfile = createTypedCallable<
  GetPublicAgentProfileRequest,
  GetPublicAgentProfileResponse
>("getPublicAgentProfile")

// =============================================================================
// User Profile Functions
// =============================================================================

export const claimUsername = createTypedCallable<
  ClaimUsernameRequest,
  ClaimUsernameResponse
>("claimUsername")

export const releaseUsername = createTypedCallable<
  ReleaseUsernameRequest,
  ReleaseUsernameResponse
>("releaseUsername")

export const updateUserProfileVisibility = createTypedCallable<
  UpdateUserProfileVisibilityRequest,
  UpdateUserProfileVisibilityResponse
>("updateUserProfileVisibility")

export const updateOwnUserProfile = createTypedCallable<
  UpdateOwnUserProfileRequest,
  UpdateOwnUserProfileResponse
>("updateOwnUserProfile")

export const syncCurrentUserAccountProfileCallable = createTypedCallable<
  SyncCurrentUserAccountProfileRequest,
  SyncCurrentUserAccountProfileResponse
>("syncCurrentUserAccountProfile")

export const deleteCurrentUserAccountData = createTypedCallable<
  DeleteCurrentUserAccountDataRequest,
  DeleteCurrentUserAccountDataResponse
>("deleteCurrentUserAccountData")

// =============================================================================
// SSO Types
// =============================================================================

export interface ConfigureSsoRequest {
  teamId: string
  protocol: "saml" | "oidc"
  domains: string[]
  enforced: boolean
  autoProvision: boolean
  defaultRole: "member" | "guest"
  saml?: {
    idpEntityId: string
    ssoUrl: string
    certificate: string
  }
  oidc?: {
    issuer: string
    clientId: string
    clientSecret: string
  }
}

export interface ConfigureSsoResponse {
  success: boolean
  providerId: string
}

export interface DeleteSsoRequest {
  teamId: string
}

export interface DeleteSsoResponse {
  success: boolean
}

export interface TestSsoConnectionRequest {
  teamId: string
  protocol: "saml" | "oidc"
  saml?: {
    ssoUrl: string
    certificate: string
  }
  oidc?: {
    issuer: string
  }
}

export interface TestSsoConnectionResponse {
  valid: boolean
  error?: string
}

export interface ResolveSsoProviderRequest {
  email: string
}

export interface ResolveSsoProviderResponse {
  sso: boolean
  providerId?: string
  enforced?: boolean
}

export interface UpdateTeamLoginMethodsRequest {
  teamId: string
  loginMethods: {
    emailPassword: boolean
    magicLink: boolean
    google: boolean
    microsoft: boolean
    apple: boolean
    sso: boolean
  }
}

export interface UpdateTeamLoginMethodsResponse {
  success: boolean
}

export interface UpdateTeamApprovedDomainsRequest {
  teamId: string
  approvedDomains: string[]
}

export interface UpdateTeamApprovedDomainsResponse {
  success: boolean
}

// =============================================================================
// SSO Functions
// =============================================================================

export const configureSso = createTypedCallable<
  ConfigureSsoRequest,
  ConfigureSsoResponse
>("configureSso")

export const deleteSso = createTypedCallable<
  DeleteSsoRequest,
  DeleteSsoResponse
>("deleteSso")

export const testSsoConnection = createTypedCallable<
  TestSsoConnectionRequest,
  TestSsoConnectionResponse
>("testSsoConnection")

export const resolveSsoProvider = createTypedCallable<
  ResolveSsoProviderRequest,
  ResolveSsoProviderResponse
>("resolveSsoProvider")

export const updateTeamLoginMethods = createTypedCallable<
  UpdateTeamLoginMethodsRequest,
  UpdateTeamLoginMethodsResponse
>("updateTeamLoginMethods")

export const updateTeamApprovedDomains = createTypedCallable<
  UpdateTeamApprovedDomainsRequest,
  UpdateTeamApprovedDomainsResponse
>("updateTeamApprovedDomains")

// =============================================================================
// Session Types
// =============================================================================

export interface RegisterSessionRequest {
  sessionId: string
  deviceName: string
  browser: string
  os: string
  deviceType: "desktop" | "mobile" | "tablet"
}

export interface RegisterSessionResponse {
  registered: boolean
  ip: string
}

export interface RevokeAllSessionsRequest {
  currentSessionId: string
}

export interface RevokeAllSessionsResponse {
  revoked: boolean
  count: number
}

export interface RevokeSessionRequest {
  sessionId: string
  currentSessionId: string
}

export interface RevokeSessionResponse {
  revoked: boolean
}

// =============================================================================
// Session Functions
// =============================================================================

export const registerSessionCallable = createTypedCallable<
  RegisterSessionRequest,
  RegisterSessionResponse
>("registerSession")

export const revokeAllSessions = createTypedCallable<
  RevokeAllSessionsRequest,
  RevokeAllSessionsResponse
>("revokeAllSessions")

export const revokeSession = createTypedCallable<
  RevokeSessionRequest,
  RevokeSessionResponse
>("revokeSession")

// =============================================================================
// Bot Chat Functions
// =============================================================================

/**
 * Send a message to the workspace-scoped Genkit chat session.
 * Creates a new session if `sessionId` is null/omitted; resumes otherwise.
 * Session history is persisted under
 * `teams/{teamId}/workspaces/{workspaceId}/botSessions/{sessionId}`.
 *
 * This callable is backed by an `onCallGenkit` flow, so it supports
 * streaming via `sendBotMessage.stream(...)` — each emitted chunk is a
 * raw text delta. The unary form (`sendBotMessage(...)`) still works and
 * resolves to the final aggregated reply.
 */
export const sendBotMessage = createTypedStreamingCallable<
  SendBotMessageRequest,
  SendBotMessageResponse,
  SendBotMessageStreamChunk
>("sendBotMessage")

/**
 * Resume a chat that was paused by an `askQuestion` interrupt with the
 * user's answer. Streams the model's continuation using the same chunk
 * shape as `sendBotMessage` — the client can pipe both into the same
 * stream-handling code path.
 */
export const respondToBotInterrupt = createTypedStreamingCallable<
  RespondToBotInterruptRequest,
  RespondToBotInterruptResponse,
  SendBotMessageStreamChunk
>("respondToBotInterrupt")

/**
 * Load an existing bot chat session's main-thread messages so the client
 * can re-render the prior conversation when the user picks a session
 * from the history sidebar.
 */
export const loadBotSession = createTypedCallable<
  LoadBotSessionRequest,
  LoadBotSessionResponse
>("loadBotSession")

/**
 * Resolve the caller's bot chat that's pinned to a specific workspace
 * node, if any. Returns `{ sessionId: null }` when no session has been
 * created for the node yet — the client treats that as a signal to start
 * a fresh session whose first send will carry `pinnedNode` and create
 * the pin server-side.
 */
export const findBotSessionByPinnedNode = createTypedCallable<
  FindBotSessionByPinnedNodeRequest,
  FindBotSessionByPinnedNodeResponse
>("findBotSessionByPinnedNode")

/**
 * Change a bot chat session's visibility (private ↔ shared). Only the
 * session owner or a team admin may invoke; the server enforces this.
 * The "public" visibility is reserved for a future iteration and will
 * be rejected by the server.
 */
export const updateBotSessionVisibility = createTypedCallable<
  UpdateBotSessionVisibilityRequest,
  UpdateBotSessionVisibilityResponse
>("updateBotSessionVisibility")

/** Rename a bot chat session. Owner or team admin only. */
export const renameBotSession = createTypedCallable<
  RenameBotSessionRequest,
  RenameBotSessionResponse
>("renameBotSession")

/**
 * Archive or unarchive a bot chat session. Archived sessions are hidden
 * from the main history list but remain accessible from the "Archived"
 * section. Owner or team admin only.
 */
export const archiveBotSession = createTypedCallable<
  ArchiveBotSessionRequest,
  ArchiveBotSessionResponse
>("archiveBotSession")

/** Delete a bot chat session permanently. Owner or team admin only. */
export const deleteBotSession = createTypedCallable<
  DeleteBotSessionRequest,
  DeleteBotSessionResponse
>("deleteBotSession")

// =============================================================================
// Team Agent Config Functions
// =============================================================================

/**
 * Read the team's agent config. Open to any team member; the response
 * always carries a fully-populated config (defaults are filled in
 * server-side for any unset field).
 */
export const getTeamAgentConfig = createTypedCallable<
  GetTeamAgentConfigRequest,
  GetTeamAgentConfigResponse
>("getTeamAgentConfig")

/**
 * Update the team's agent config. Owner / admin only — non-admins
 * receive `permission-denied`. Returns the merged effective config so
 * the client can swap its local copy wholesale.
 */
export const updateTeamAgentConfig = createTypedCallable<
  UpdateTeamAgentConfigRequest,
  UpdateTeamAgentConfigResponse
>("updateTeamAgentConfig")

// =============================================================================
// Workflows (team automations)
// =============================================================================

export type WorkflowScheduleInput =
  | { type: "interval"; everyHours: number }
  | { type: "daily"; atMinuteUTC: number }
  | { type: "weekly"; dayOfWeek: number; atMinuteUTC: number }

export type WorkflowTriggerInput =
  | { type: "schedule"; schedule: WorkflowScheduleInput }
  | { type: "event"; scope: "code" | "write"; debounceMinutes?: number }
  | { type: "manual" }

export interface WorkflowNodeRefInput {
  scope: "code" | "write"
  nodeId: string
}

export type WorkflowUpdateModeInput = "automatic" | "require_review"

export interface CreateWorkflowDraft {
  name: string
  description?: string
  /** Seed for the workflow's generative avatar; falls back to `name`. */
  avatarSeed?: string
  agentId: string
  workspaceId: string
  /** Tree the workflow may edit; null/undefined = the workspace's `write` tree. */
  targetScope?: "code" | "write" | null
  /** The procedure the agent follows each run (the brief's `instructions`). */
  instructions: string
  /** Optional supplementary instructions appended to `instructions`. */
  additionalPrompt?: string
  trigger: WorkflowTriggerInput
  contextNodes?: WorkflowNodeRefInput[]
  /** `require_review` (default) stages edits for approval; `automatic` applies. */
  updateMode?: WorkflowUpdateModeInput
  enabled?: boolean
  /**
   * P3 — run headless turns with this member's connection bindings ("runs
   * with {member}'s connected accounts"). The server accepts only the
   * CALLER's own uid (consent is structural); null clears.
   */
  actsAsUid?: string | null
}

/** Update can change anything except the immutable agent/workspace binding. */
export type UpdateWorkflowPatch = Partial<
  Omit<CreateWorkflowDraft, "agentId" | "workspaceId">
>

export interface CreateTeamWorkflowRequest {
  teamId: string
  draft: CreateWorkflowDraft
}
export interface CreateTeamWorkflowResponse {
  workflowId: string
}
export interface UpdateTeamWorkflowRequest {
  teamId: string
  workspaceId: string
  workflowId: string
  patch: UpdateWorkflowPatch
}
export interface SetTeamWorkflowEnabledRequest {
  teamId: string
  workspaceId: string
  workflowId: string
  enabled: boolean
}
export interface ArchiveTeamWorkflowRequest {
  teamId: string
  workspaceId: string
  workflowId: string
  archived: boolean
}
export interface DeleteTeamWorkflowRequest {
  teamId: string
  workspaceId: string
  workflowId: string
}
export interface RunTeamWorkflowNowRequest {
  teamId: string
  workspaceId: string
  workflowId: string
}
export interface RunTeamWorkflowNowResponse {
  runId: string
}

export const createTeamWorkflow = createTypedCallable<
  CreateTeamWorkflowRequest,
  CreateTeamWorkflowResponse
>("createTeamWorkflow")

export const updateTeamWorkflow = createTypedCallable<
  UpdateTeamWorkflowRequest,
  { ok: boolean }
>("updateTeamWorkflow")

export const setTeamWorkflowEnabled = createTypedCallable<
  SetTeamWorkflowEnabledRequest,
  { ok: boolean }
>("setTeamWorkflowEnabled")

export const archiveTeamWorkflow = createTypedCallable<
  ArchiveTeamWorkflowRequest,
  { ok: boolean }
>("archiveTeamWorkflow")

export const deleteTeamWorkflow = createTypedCallable<
  DeleteTeamWorkflowRequest,
  { ok: boolean }
>("deleteTeamWorkflow")

export const runTeamWorkflowNow = createTypedCallable<
  RunTeamWorkflowNowRequest,
  RunTeamWorkflowNowResponse
>("runTeamWorkflowNow")

/** Approve (apply staged edits) or reject (discard) a `require_review` run. */
export type WorkflowReviewDecision = "approve" | "reject"
export interface ReviewTeamWorkflowRunRequest {
  teamId: string
  workspaceId: string
  runId: string
  decision: WorkflowReviewDecision
}
export interface ReviewTeamWorkflowRunResponse {
  ok: boolean
  /** The run's terminal status after the decision ("applied" | "cancelled"). */
  status: string
}
export const reviewTeamWorkflowRun = createTypedCallable<
  ReviewTeamWorkflowRunRequest,
  ReviewTeamWorkflowRunResponse
>("reviewTeamWorkflowRun")

/** Permanently remove a run from history (admin-gated). */
export interface DeleteTeamWorkflowRunRequest {
  teamId: string
  workspaceId: string
  runId: string
}
export const deleteTeamWorkflowRun = createTypedCallable<
  DeleteTeamWorkflowRunRequest,
  { ok: boolean }
>("deleteTeamWorkflowRun")

// =============================================================================
// Unified Integrations (agent | tool)
// =============================================================================
//
// The unified CRUD + install/uninstall surface for the AGENT and TOOL
// integration types (workflows keep their dedicated callables above — the
// client registry in `useIntegrations` routes per type). Every mutation
// returns the resolved integration so the caller can reconcile optimistically.

/** Mutation response carrying the resolved integration (null if it vanished). */
export interface IntegrationMutationResponse {
  integration: IIntegration | null
}

export interface CreateIntegrationRequest {
  teamId: string
  type: "agent" | "tool"
  draft: IAgentIntegrationDraft | IToolIntegrationDraft
}

/**
 * Update an integration. For an existing doc (custom, or an already-diverged
 * built-in) pass `integrationId`; for a built-in with no divergence doc yet,
 * pass `type` + `sourceKey` (the server materializes the doc, mirroring
 * setIntegrationEnabled). Built-in AGENTS accept envelope + spec patches —
 * the spec is stored as a customization override, and `spec: null` clears it
 * back to the catalog default. Built-in tools and published docs reject edits.
 */
export interface UpdateIntegrationRequest {
  teamId: string
  integrationId?: string
  type?: "agent" | "tool"
  sourceKey?: string
  patch: IAgentIntegrationPatch | IToolIntegrationPatch
}

/**
 * Toggle enable. For an existing doc pass `integrationId`; for a built-in with
 * no divergence doc yet, pass `type` + `sourceKey` (the server materializes a
 * thin doc carrying the flag).
 */
export interface SetIntegrationEnabledRequest {
  teamId: string
  integrationId?: string
  type?: "agent" | "tool"
  sourceKey?: string
  enabled: boolean
}

/**
 * Install a built-in (or, later, published) integration by catalog key, OR
 * re-install (un-archive) an existing custom integration by id.
 */
export interface InstallIntegrationRequest {
  teamId: string
  type?: "agent" | "tool"
  sourceKey?: string
  integrationId?: string
}

/** Uninstall = soft-archive. Built-in via type+sourceKey, custom via id. */
export interface UninstallIntegrationRequest {
  teamId: string
  integrationId?: string
  type?: "agent" | "tool"
  sourceKey?: string
}

export interface DeleteIntegrationRequest {
  teamId: string
  integrationId: string
}

export interface DeleteIntegrationResponse {
  integrationId: string
  deleted: true
}

export const createIntegration = createTypedCallable<
  CreateIntegrationRequest,
  IntegrationMutationResponse
>("createIntegration")

export const updateIntegration = createTypedCallable<
  UpdateIntegrationRequest,
  IntegrationMutationResponse
>("updateIntegration")

export const setIntegrationEnabled = createTypedCallable<
  SetIntegrationEnabledRequest,
  IntegrationMutationResponse
>("setIntegrationEnabled")

export const installIntegration = createTypedCallable<
  InstallIntegrationRequest,
  IntegrationMutationResponse
>("installIntegration")

export const uninstallIntegration = createTypedCallable<
  UninstallIntegrationRequest,
  IntegrationMutationResponse
>("uninstallIntegration")

export const deleteIntegration = createTypedCallable<
  DeleteIntegrationRequest,
  DeleteIntegrationResponse
>("deleteIntegration")

// =============================================================================
// Connection Functions (docs/connections-feature.prompt.md)
// =============================================================================

/** Install/uninstall target an app by its provider key (admin-only). */
export interface ConnectionRequest {
  teamId: string
  provider: string
}

export interface ConnectionMutationResponse {
  ok: true
}

/**
 * Exchange the GIS popup's one-time authorization code for the caller's own
 * binding (member-gated; the server holds the OAuth client secret).
 */
export interface CompleteConnectionBindingRequest extends ConnectionRequest {
  code: string
  /**
   * Desktop (Tauri) system-browser flow only: the loopback redirect the
   * authorization used. The server allowlists loopback hosts and falls back
   * to the web flow's `postmessage` when omitted.
   */
  redirectUri?: string
}

export interface CompleteConnectionBindingResponse {
  ok: true
  /** The bound Google account's email, when the id_token carried one. */
  email: string | null
}

export const installConnection = createTypedCallable<
  ConnectionRequest,
  ConnectionMutationResponse
>("installConnection")

export const uninstallConnection = createTypedCallable<
  ConnectionRequest,
  ConnectionMutationResponse
>("uninstallConnection")

export interface SetConnectionDisabledRequest extends ConnectionRequest {
  /** true = team-wide kill switch on; false = re-enable. */
  disabled: boolean
}

/**
 * Owner/Admin team-wide kill switch — pauses the app (tool registration,
 * token minting, new connects) without touching bindings or integration
 * docs. Distinct from `uninstallConnection`, which removes them.
 */
export const setConnectionDisabled = createTypedCallable<
  SetConnectionDisabledRequest,
  ConnectionMutationResponse
>("setConnectionDisabled")

export const completeConnectionBinding = createTypedCallable<
  CompleteConnectionBindingRequest,
  CompleteConnectionBindingResponse
>("completeConnectionBinding")

export const removeConnectionBinding = createTypedCallable<
  ConnectionRequest,
  ConnectionMutationResponse
>("removeConnectionBinding")

/**
 * Drive picker backend (docs/connections-google-drive-d3.prompt.md): browse
 * the CALLER's connected Google Drive server-side — the in-app replacement
 * for Google's Picker widget, so OAuth tokens never reach the browser.
 */
export interface DriveFileRow {
  id: string
  name: string
  mimeType: string
  modifiedTime: string | null
  owner: string | null
  link: string | null
  /** Bytes; null for native Google files. */
  size: number | null
}

export interface ListDriveFilesRequest {
  teamId: string
  query?: string
  mimeClass?: string
  /** Restrict to a folder (id or Drive URL). */
  folderId?: string
  pageToken?: string
}

export interface ListDriveFilesResponse {
  files: DriveFileRow[]
  nextPageToken: string | null
}

export const listDriveFiles = createTypedCallable<
  ListDriveFilesRequest,
  ListDriveFilesResponse
>("listDriveFiles")

/**
 * Import one Drive file as a chat-session attachment. Bytes move
 * Google→Functions→Storage server-side; Docs arrive as markdown, Sheets as
 * CSV, everything else (PDFs, images) as raw bytes — same size/blocked-type
 * gates as direct uploads.
 */
export interface ImportDriveSessionAttachmentRequest {
  teamId: string
  workspaceId: string
  sessionId: string
  /** Drive file id or URL from a listDriveFiles row. */
  fileId: string
}

export interface ImportDriveSessionAttachmentResponse {
  attachmentId: string
  displayName: string
  mimeType: string
  size: number
}

export const importDriveSessionAttachment = createTypedCallable<
  ImportDriveSessionAttachmentRequest,
  ImportDriveSessionAttachmentResponse
>("importDriveSessionAttachment")

/**
 * Import one Drive file as a WORKSPACE NODE attachment — same server-side
 * byte path and gates as the session variant, landing in the node's
 * attachments subcollection (audit-logged like direct uploads).
 */
export interface ImportDriveNodeAttachmentRequest {
  teamId: string
  workspaceId: string
  scope: WorkspaceNodeScope
  nodeId: string
  /** Drive file id or URL from a listDriveFiles row. */
  fileId: string
}

export interface ImportDriveNodeAttachmentResponse {
  attachmentId: string
  displayName: string
  mimeType: string
  size: number
}

export const importDriveNodeAttachment = createTypedCallable<
  ImportDriveNodeAttachmentRequest,
  ImportDriveNodeAttachmentResponse
>("importDriveNodeAttachment")

/**
 * Materialize a predefined catalog workflow as a `presetKey != null` instance.
 * The server fills name/description/instructions/trigger/updateMode from the
 * preset; the caller picks which agent + workspace it binds to.
 */
export interface EnableTeamWorkflowPresetRequest {
  teamId: string
  presetKey: string
  workspaceId: string
  agentId: string
}
export interface EnableTeamWorkflowPresetResponse {
  workflowId: string
}
export const enableTeamWorkflowPreset = createTypedCallable<
  EnableTeamWorkflowPresetRequest,
  EnableTeamWorkflowPresetResponse
>("enableTeamWorkflowPreset")

/**
 * Make a predefined preset available to the team (Integrations toggle), or
 * remove it. Availability is workspace-agnostic — the team tier of the
 * two-tier model. Removing also archives every live deployment of that preset
 * across the team (the `archived` count is how many were archived).
 */
export interface SetTeamWorkflowAvailabilityRequest {
  teamId: string
  presetKey: string
  available: boolean
}
export interface SetTeamWorkflowAvailabilityResponse {
  ok: boolean
  archived: number
}
export const setTeamWorkflowAvailability = createTypedCallable<
  SetTeamWorkflowAvailabilityRequest,
  SetTeamWorkflowAvailabilityResponse
>("setTeamWorkflowAvailability")

// =============================================================================
// Node Summarize Request/Response Types — structured output demo.
// =============================================================================

export interface SummarizeNodeRequest {
  teamId: string
  workspaceId: string
  scope: "code" | "write"
  nodeId: string
}

// =============================================================================
// Find Related Nodes Request/Response Types — backs the inspector sidebar's
// "Related" tab and shares its shape with the chat tool of the same name.
// =============================================================================

/**
 * Where the nearest-neighbor query should look. Mirrors the server enum
 * in `functions/src/botLink.ts`. `"both"` is the default — most "Related"
 * surfaces want cross-scope matches.
 */
export type FindRelatedNodesSearchScope = "code" | "write" | "both"

export interface FindRelatedNodesRequest {
  teamId: string
  workspaceId: string
  /** Scope of the SOURCE node — concrete, never "both". */
  scope: "code" | "write"
  nodeId: string
  searchScope?: FindRelatedNodesSearchScope
  /** Default 5; max 10. */
  limit?: number
}

export interface FindRelatedNodesResult {
  scope: "code" | "write"
  nodeId: string
  name: string
  type: "folder" | "file"
  snippet: string
  /** Cosine distance — lower is closer. Omitted when the retriever
   *  didn't populate the field (rare). */
  distance?: number
}

export interface FindRelatedNodesResponse {
  results: FindRelatedNodesResult[]
  /** True when more matches existed than `limit` allowed. */
  truncated: boolean
}

/**
 * Structured summary produced by the server. Matches the Zod schema in
 * `functions/src/botSummarize.ts` — keep both in sync. Field shapes
 * come from `output: { schema }` on the server's `ai.generate` call.
 */
export interface SummarizeNodeResponse {
  summary: string
  keyPoints: string[]
  suggestedTags: string[]
  /** Wire-name of the model that produced the summary. */
  model: string
}

/**
 * Summarize a workspace node. Demonstrates structured output — the
 * server uses `ai.generate({ output: { schema } })` to force the model
 * into a JSON shape that's validated before reaching the client. No
 * streaming; the caller blocks on the full structured payload.
 */
export const summarizeNode = createTypedCallable<
  SummarizeNodeRequest,
  SummarizeNodeResponse
>("summarizeNode")

/**
 * Find workspace nodes related to a given source node — backs the
 * inspector sidebar's "Related" tab. Reuses the source's stored
 * embedding as the query vector, so no embed call is made at lookup
 * time. Membership-gated server-side; non-members get permission-denied.
 */
export const findRelatedNodes = createTypedCallable<
  FindRelatedNodesRequest,
  FindRelatedNodesResponse
>("findRelatedNodes")

// =============================================================================
// AI Config Generation Request/Response Types — "Prompt" tab in the custom
// agent / custom tool editors. Mirror the structured output of
// functions/src/configGenerators.ts — keep both in sync.
// =============================================================================

export interface GenerateConfigRequest {
  teamId: string
  /** Plain-English description of the agent/tool the admin wants. */
  prompt: string
}

/**
 * Structured agent config produced by `generateTeamAgentConfig`. Shapes the
 * editor draft directly — every string is clamped server-side to its domain
 * bound so the generated draft is always saveable. `model` is the wire-name
 * of the model that produced it (surfaced in the UI for transparency).
 */
export interface GeneratedTeamAgentConfig {
  name: string
  description: string
  avatarSeed: string
  systemPromptBase: string
  promptSuffixes: { auto: string; agent: string; manual: string }
  tools: {
    rollDice: boolean
    askQuestion: boolean
    searchWorkspaceNodes: boolean
    summarizeNode: boolean
  }
  model: string
}

/**
 * Structured custom-tool config produced by `generateTeamCustomToolConfig`.
 * `name` is coerced server-side to a valid identifier; `action` is a fully
 * normalized discriminated union ready to drop into the editor draft.
 */
export interface GeneratedTeamCustomToolConfig {
  name: string
  displayName: string
  description: string
  avatarSeed: string
  inputSchema: ITeamCustomTool["inputSchema"]
  outputSchema: ITeamCustomTool["outputSchema"]
  action: ICustomToolAction
  model: string
}

/**
 * Generate a custom-agent configuration from a natural-language prompt.
 * Owner/admin only; uses the team's configured model. Returns a draft the
 * editor merges in — admins review and tweak before saving.
 */
export const generateTeamAgentConfig = createTypedCallable<
  GenerateConfigRequest,
  GeneratedTeamAgentConfig
>("generateTeamAgentConfig")

/**
 * Generate a custom-tool configuration from a natural-language prompt.
 * Owner/admin only. Same model + draft semantics as
 * {@link generateTeamAgentConfig}.
 */
export const generateTeamCustomToolConfig = createTypedCallable<
  GenerateConfigRequest,
  GeneratedTeamCustomToolConfig
>("generateTeamCustomToolConfig")

/**
 * Structured workflow config produced by `generateTeamWorkflowConfig`. Shapes
 * the workflow editor draft directly — every string is clamped server-side and
 * the `trigger` is normalized to a valid discriminated union. `agentId`,
 * `workspaceId`, `contextNodes`, and `enabled` are intentionally NOT generated
 * (the model never sees team data and can't know node ids): the editor keeps
 * its own values for those and merges only the fields below.
 */
export interface GeneratedTeamWorkflowConfig {
  name: string
  description: string
  avatarSeed: string
  instructions: string
  additionalPrompt: string
  /** null = the workspace's default `write` tree. */
  targetScope: "code" | "write" | null
  trigger: WorkflowTriggerInput
  updateMode: WorkflowUpdateModeInput
  model: string
}

/**
 * Generate a workflow configuration from a natural-language prompt.
 * Owner/admin only. Same model + draft semantics as
 * {@link generateTeamAgentConfig}; the editor merges the result into its draft
 * (preserving the chosen agent + workspace) for review before saving.
 */
export const generateTeamWorkflowConfig = createTypedCallable<
  GenerateConfigRequest,
  GeneratedTeamWorkflowConfig
>("generateTeamWorkflowConfig")

// =============================================================================
// Composable Hook
// =============================================================================

/**
 * Composable for calling cloud functions with audit logging.
 *
 * Usage:
 * ```ts
 * const {
 *   createTeam,
 *   updateTeam,
 *   deleteTeam,
 *   createWorkspace,
 *   updateWorkspace,
 *   deleteWorkspace,
 *   assignRoleToUser,
 *   removeMember,
 *   removeMembers,
 * } = useFunctions()
 *
 * // Create team
 * const { data } = await createTeam({ name: 'My Team' })
 * console.log('Created team:', data.teamId)
 *
 * // Create workspace
 * const { data: wsData } = await createWorkspace({
 *   teamId: data.teamId,
 *   name: 'My Workspace'
 * })
 * console.log('Created workspace:', wsData.workspaceId)
 * console.log('Audit log ID:', wsData.logId)
 * ```
 */
// =============================================================================
// Memory Functions
// =============================================================================

export interface CreateMemoryRequest {
  teamId: string
  workspaceId: string
  content: string
  summary?: string
  tags?: string[]
  category?: MemoryCategory
  importance?: number
  visibility?: MemoryVisibility
  metadata?: Record<string, unknown>
}

export interface CreateMemoryResponse {
  memoryId: string
  logId?: string
}

export interface UpdateMemoryRequest {
  teamId: string
  workspaceId: string
  memoryId: string
  content?: string
  summary?: string
  tags?: string[]
  category?: MemoryCategory
  importance?: number
}

export interface UpdateMemoryResponse {
  memoryId: string
  updated: boolean
  logId?: string
}

/** Shared target shape for the by-id memory mutations. */
export interface MemoryTargetRequest {
  teamId: string
  workspaceId: string
  memoryId: string
}

export interface DeleteMemoryResponse {
  memoryId: string
  deleted: boolean
  logId?: string
}

export interface ArchiveMemoryResponse {
  memoryId: string
  archived: boolean
  logId?: string
}

export interface PinMemoryResponse {
  memoryId: string
  pinned: boolean
  logId?: string
}

export interface ShareMemoryResponse {
  memoryId: string
  visibility: MemoryVisibility
  logId?: string
}

export const createMemory = createTypedCallable<
  CreateMemoryRequest,
  CreateMemoryResponse
>("createMemory")

export const updateMemory = createTypedCallable<
  UpdateMemoryRequest,
  UpdateMemoryResponse
>("updateMemory")

export const deleteMemory = createTypedCallable<
  MemoryTargetRequest,
  DeleteMemoryResponse
>("deleteMemory")

export const archiveMemory = createTypedCallable<
  MemoryTargetRequest,
  ArchiveMemoryResponse
>("archiveMemory")

export const unarchiveMemory = createTypedCallable<
  MemoryTargetRequest,
  ArchiveMemoryResponse
>("unarchiveMemory")

export const pinMemory = createTypedCallable<
  MemoryTargetRequest,
  PinMemoryResponse
>("pinMemory")

export const unpinMemory = createTypedCallable<
  MemoryTargetRequest,
  PinMemoryResponse
>("unpinMemory")

export const shareMemory = createTypedCallable<
  MemoryTargetRequest,
  ShareMemoryResponse
>("shareMemory")

export const unshareMemory = createTypedCallable<
  MemoryTargetRequest,
  ShareMemoryResponse
>("unshareMemory")

export interface PurgeWorkspaceMemoriesRequest {
  teamId: string
  workspaceId: string
}

export interface PurgeWorkspaceMemoriesResponse {
  deleted: number
  logId: string
}

export const purgeWorkspaceMemories = createTypedCallable<
  PurgeWorkspaceMemoriesRequest,
  PurgeWorkspaceMemoriesResponse
>("purgeWorkspaceMemories")

export interface ArchiveWorkspaceMemoriesRequest {
  teamId: string
  workspaceId: string
}

export interface ArchiveWorkspaceMemoriesResponse {
  archived: number
  logId: string
}

export const archiveWorkspaceMemories = createTypedCallable<
  ArchiveWorkspaceMemoriesRequest,
  ArchiveWorkspaceMemoriesResponse
>("archiveWorkspaceMemories")

export interface MyPrivateMemoriesRequest {
  teamId: string
  workspaceId: string
}

export interface ArchiveMyPrivateMemoriesResponse {
  archived: number
  logId: string
}

export interface PurgeMyPrivateMemoriesResponse {
  deleted: number
  logId: string
}

export const archiveMyPrivateMemories = createTypedCallable<
  MyPrivateMemoriesRequest,
  ArchiveMyPrivateMemoriesResponse
>("archiveMyPrivateMemories")

export const purgeMyPrivateMemories = createTypedCallable<
  MyPrivateMemoriesRequest,
  PurgeMyPrivateMemoriesResponse
>("purgeMyPrivateMemories")

export function useFunctions() {
  return {
    // Team operations
    createTeam,
    updateTeam,
    deleteTeam,

    // Workspace operations
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,

    // Workspace node operations
    createWorkspaceNode,
    renameWorkspaceNode,
    moveWorkspaceNode,
    archiveWorkspaceNode,
    unarchiveWorkspaceNode,
    deleteWorkspaceNode,
    updateWorkspaceNodeContent,

    // Membership operations
    assignRoleToUser,
    removeMember,
    removeMembers,

    // Invitation operations
    sendInvitation,
    resendInvitation,
    updateInvitationRole,
    cancelInvitation,
    declineInvitation,

    // Billing operations
    createCheckoutSession,
    createBillingPortalSession,
    changeSubscriptionPlan,
    cancelSubscription,
    restoreSubscription,
    getBillingStatus,
    getBillingCatalog,

    // Notification operations
    sendTestNotification,
    markAllNotificationsRead,
    markAllNotificationsUnread,
    markAllNotificationsDone,
    markAllNotificationsInbox,
    markAllNotificationsSaved,
    deleteAllNotifications,
    deleteNotification,

    // Public profile operations
    getPublicTeamMembers,
    getPublicTeamsForUser,
    getPublicAgentProfile,
    claimUsername,
    releaseUsername,
    updateUserProfileVisibility,
    updateOwnUserProfile,
    syncCurrentUserAccountProfileCallable,
    deleteCurrentUserAccountData,

    // SSO operations
    configureSso,
    deleteSso,
    testSsoConnection,
    resolveSsoProvider,
    updateTeamLoginMethods,
    updateTeamApprovedDomains,

    // Session operations
    registerSessionCallable,
    revokeAllSessions,
    revokeSession,

    // Bot chat operations
    sendBotMessage,
    loadBotSession,
    findBotSessionByPinnedNode,
    updateBotSessionVisibility,
    renameBotSession,
    archiveBotSession,
    deleteBotSession,

    // Team agent config operations
    getTeamAgentConfig,
    updateTeamAgentConfig,

    // Structured-output sub-flows
    summarizeNode,
    findRelatedNodes,

    // AI config generation ("Prompt" tab)
    generateTeamAgentConfig,
    generateTeamCustomToolConfig,
  }
}
