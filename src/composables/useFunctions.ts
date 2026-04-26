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
  IBotSessionVisibility,
  ITeamBilling,
} from "@/types/domain"
import type { IMembershipRole } from "@/types/membership"
import type { WorkspaceNodeScope } from "@/types/nodes"
import { httpsCallable, type HttpsCallableResult } from "firebase/functions"

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

export interface SendBotMessageRequest {
  teamId: string
  workspaceId: string
  /** Pass null/undefined to start a new session; the response carries the new id. */
  sessionId?: string | null
  message: string
}

export interface SendBotMessageResponse {
  sessionId: string
  reply: string
}

export type BotChatRole = "user" | "agent"

export interface BotChatHistoryMessage {
  role: BotChatRole
  content: string
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

export const getPublicTeamMembers = createTypedCallable<
  GetPublicTeamMembersRequest,
  GetPublicTeamMembersResponse
>("getPublicTeamMembers")

export const getPublicTeamsForUser = createTypedCallable<
  GetPublicTeamsForUserRequest,
  GetPublicTeamsForUserResponse
>("getPublicTeamsForUser")

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
 */
export const sendBotMessage = createTypedCallable<
  SendBotMessageRequest,
  SendBotMessageResponse
>("sendBotMessage")

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

    // Public profile operations
    getPublicTeamMembers,
    getPublicTeamsForUser,

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
    updateBotSessionVisibility,
    renameBotSession,
    archiveBotSession,
    deleteBotSession,
  }
}
