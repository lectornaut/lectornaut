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
  IBotAgentConfig,
  IBotAgentModel,
  IBotAgentToolToggles,
  IBotSessionVisibility,
  ICustomToolAction,
  ITeamAgent,
  ITeamBilling,
  ITeamCustomTool,
} from "@/types/domain"
import type { IMembershipRole } from "@/types/membership"
import type { WorkspaceNodeScope } from "@/types/nodes"
import type { INotificationStatus } from "@/types/notification"
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
  defaultMode: IBotAgentConfig["defaultMode"]
  systemPromptBase: string
  promptSuffixes: Partial<IBotAgentConfig["promptSuffixes"]>
  tools: Partial<IBotAgentConfig["tools"]>
  builtInAgents: Partial<IBotAgentConfig["builtInAgents"]>
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
// Team Custom Agents Request/Response Types
// =============================================================================

/**
 * Creation payload for `createTeamAgent`. `name` and `systemPromptBase`
 * are required because the agent can't function without them. Everything
 * else defaults server-side (empty strings for text, all-true for tools).
 *
 * Tools is partial — the server fills missing keys with `true`, so an
 * older client that doesn't know about a newly-added tool still creates
 * an agent that has access to it.
 */
export interface CreateTeamAgentDraft {
  name: string
  description?: string
  avatarSeed?: string
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

export interface CreateTeamAgentRequest {
  teamId: string
  draft: CreateTeamAgentDraft
}

export interface CreateTeamAgentResponse {
  agent: ITeamAgent
}

/**
 * Update payload — every field optional. Only sent fields are written;
 * nested `promptSuffixes` and `tools` patches are merged server-side
 * onto the saved record so omitted keys keep their prior values.
 *
 * `enabled` rides along here for symmetry, but the dedicated
 * `setTeamAgentEnabled` callable is preferred for the row's
 * Switch — narrower surface, cleaner audit trail, no risk of
 * clobbering an in-flight inline edit on another field.
 */
export type UpdateTeamAgentPatch = Partial<CreateTeamAgentDraft> & {
  enabled?: boolean
}

export interface UpdateTeamAgentRequest {
  teamId: string
  agentId: string
  patch: UpdateTeamAgentPatch
}

export interface UpdateTeamAgentResponse {
  agent: ITeamAgent
}

export interface ArchiveTeamAgentRequest {
  teamId: string
  agentId: string
}

export interface ArchiveTeamAgentResponse {
  agent: ITeamAgent
}

export interface RestoreTeamAgentRequest {
  teamId: string
  agentId: string
}

export interface RestoreTeamAgentResponse {
  agent: ITeamAgent
}

/**
 * Set the agent's `enabled` toggle. Mirrors the team provider toggle
 * pattern — a dedicated callable rather than piggybacking on
 * `updateTeamAgent` so the audit trail reads cleanly ("admin disabled
 * X" vs "admin updated X with {enabled:false}") and the click can't
 * race with a concurrent inline edit on another field.
 */
export interface SetTeamAgentEnabledRequest {
  teamId: string
  agentId: string
  enabled: boolean
}

export interface SetTeamAgentEnabledResponse {
  agent: ITeamAgent
}

/**
 * Hard-delete an agent (irreversible). The doc is removed from
 * Firestore; existing chats that referenced the agent fall back to
 * the team default at dispatch time and the client renders a "Deleted"
 * badge for the now-missing record. No server-side confirmation gate
 * beyond the admin role check — the client owns the AlertDialog.
 *
 * Idempotent: calling on an already-deleted id returns success
 * without error (the end state matches what the caller asked for).
 */
export interface DeleteTeamAgentRequest {
  teamId: string
  agentId: string
}

export interface DeleteTeamAgentResponse {
  agentId: string
  deleted: true
}

// =============================================================================
// Team Custom Tools Request/Response Types
// =============================================================================

/**
 * Creation payload for `createTeamCustomTool`. Required fields:
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

export interface CreateTeamCustomToolRequest {
  teamId: string
  draft: CreateTeamCustomToolDraft
}

export interface CreateTeamCustomToolResponse {
  tool: ITeamCustomTool
}

/**
 * Update payload — every field optional; only sent fields are written.
 * `enabled` rides along here for symmetry; prefer `setTeamCustomToolEnabled`
 * for the row's Switch (cleaner audit trail).
 */
export type UpdateTeamCustomToolPatch = Partial<CreateTeamCustomToolDraft> & {
  enabled?: boolean
}

export interface UpdateTeamCustomToolRequest {
  teamId: string
  toolId: string
  patch: UpdateTeamCustomToolPatch
}

export interface UpdateTeamCustomToolResponse {
  tool: ITeamCustomTool
}

export interface ArchiveTeamCustomToolRequest {
  teamId: string
  toolId: string
}

export interface ArchiveTeamCustomToolResponse {
  tool: ITeamCustomTool
}

export interface RestoreTeamCustomToolRequest {
  teamId: string
  toolId: string
}

export interface RestoreTeamCustomToolResponse {
  tool: ITeamCustomTool
}

export interface SetTeamCustomToolEnabledRequest {
  teamId: string
  toolId: string
  enabled: boolean
}

export interface SetTeamCustomToolEnabledResponse {
  tool: ITeamCustomTool
}

export interface DeleteTeamCustomToolRequest {
  teamId: string
  toolId: string
}

export interface DeleteTeamCustomToolResponse {
  toolId: string
  deleted: true
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
// Team Custom Agents Functions
// =============================================================================

/**
 * Create a new team-scoped custom agent. Owner / admin only — non-admins
 * receive `permission-denied`. Server caps active (non-archived) agents
 * at 50; over the cap the call fails with `failed-precondition`.
 */
export const createTeamAgent = createTypedCallable<
  CreateTeamAgentRequest,
  CreateTeamAgentResponse
>("createTeamAgent")

/**
 * Update an existing team agent. Owner / admin only. Nested objects
 * (promptSuffixes, tools) are deep-merged server-side; omitted keys
 * retain their previous values.
 */
export const updateTeamAgent = createTypedCallable<
  UpdateTeamAgentRequest,
  UpdateTeamAgentResponse
>("updateTeamAgent")

/**
 * Soft-delete an agent. Sets `archivedAt` to the server timestamp. The
 * doc stays readable for sessions that reference it; pickers and
 * cross-agent transfer references skip archived agents. Reversible via
 * `restoreTeamAgent`.
 */
export const archiveTeamAgent = createTypedCallable<
  ArchiveTeamAgentRequest,
  ArchiveTeamAgentResponse
>("archiveTeamAgent")

/**
 * Restore an archived agent. Clears `archivedAt` back to null. Re-counts
 * against the active cap, so restoring requires headroom (archive
 * another first if at the cap).
 */
export const restoreTeamAgent = createTypedCallable<
  RestoreTeamAgentRequest,
  RestoreTeamAgentResponse
>("restoreTeamAgent")

/**
 * Flip an agent's `enabled` toggle. Disabled agents are filtered out
 * of pickers AND gated out of dispatch — even when a session has the
 * agent persisted as its `activeAgentId`, the server falls back to
 * the team default until re-enabled. Owner / admin only.
 */
export const setTeamAgentEnabled = createTypedCallable<
  SetTeamAgentEnabledRequest,
  SetTeamAgentEnabledResponse
>("setTeamAgentEnabled")

/**
 * Hard-delete an agent (irreversible). The Firestore doc is removed;
 * the team's selectable agent count drops by one immediately. Owner /
 * admin only. Existing chats referencing the deleted agent continue
 * to function under the team default persona — the badge renders
 * "Deleted" so the user sees what happened.
 */
export const deleteTeamAgent = createTypedCallable<
  DeleteTeamAgentRequest,
  DeleteTeamAgentResponse
>("deleteTeamAgent")

// =============================================================================
// Team Custom Tools Functions
// =============================================================================

export const createTeamCustomTool = createTypedCallable<
  CreateTeamCustomToolRequest,
  CreateTeamCustomToolResponse
>("createTeamCustomTool")

export const updateTeamCustomTool = createTypedCallable<
  UpdateTeamCustomToolRequest,
  UpdateTeamCustomToolResponse
>("updateTeamCustomTool")

export const archiveTeamCustomTool = createTypedCallable<
  ArchiveTeamCustomToolRequest,
  ArchiveTeamCustomToolResponse
>("archiveTeamCustomTool")

export const restoreTeamCustomTool = createTypedCallable<
  RestoreTeamCustomToolRequest,
  RestoreTeamCustomToolResponse
>("restoreTeamCustomTool")

export const setTeamCustomToolEnabled = createTypedCallable<
  SetTeamCustomToolEnabledRequest,
  SetTeamCustomToolEnabledResponse
>("setTeamCustomToolEnabled")

export const deleteTeamCustomTool = createTypedCallable<
  DeleteTeamCustomToolRequest,
  DeleteTeamCustomToolResponse
>("deleteTeamCustomTool")

// =============================================================================
// Node Summarize Request/Response Types — structured output demo.
// =============================================================================

export interface SummarizeNodeRequest {
  teamId: string
  workspaceId: string
  scope: "code" | "write"
  nodeId: string
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
    claimUsername,
    releaseUsername,
    updateUserProfileVisibility,
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

    // Team custom agent CRUD
    createTeamAgent,
    updateTeamAgent,
    archiveTeamAgent,
    restoreTeamAgent,
    setTeamAgentEnabled,
    deleteTeamAgent,

    // Team custom tool CRUD
    createTeamCustomTool,
    updateTeamCustomTool,
    archiveTeamCustomTool,
    restoreTeamCustomTool,
    setTeamCustomToolEnabled,
    deleteTeamCustomTool,

    // Structured-output sub-flows
    summarizeNode,

    // AI config generation ("Prompt" tab)
    generateTeamAgentConfig,
    generateTeamCustomToolConfig,
  }
}
