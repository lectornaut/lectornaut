import type {
  agentIntegrationDraftSchema,
  agentIntegrationPatchSchema,
  agentIntegrationSpecSchema,
  billingIntervalSchema,
  billingPlanKeySchema,
  botAgentConfigSchema,
  botAgentDefaultModeSchema,
  botAgentModelSchema,
  botAgentModelTogglesSchema,
  botAgentProviderSchema,
  botAgentProviderTogglesSchema,
  botAgentToolTogglesSchema,
  botChatRoleSchema,
  botMessageSegmentSchema,
  botSessionMessageSchema,
  botSessionSchema,
  botSessionVisibilitySchema,
  botToolCallSchema,
  customToolActionSchema,
  customToolFieldSchema,
  groupSchema,
  integrationSchema,
  integrationSourceSchema,
  integrationTypeSchema,
  membershipPreferencesSchema,
  teamAgentSchema,
  teamBillingSchema,
  teamCustomToolSchema,
  teamSchema,
  toolIntegrationDraftSchema,
  toolIntegrationPatchSchema,
  toolIntegrationSpecSchema,
  userPreferencesSchema,
  userProfileSchema,
  userSchema,
  usernameClaimSchema,
  workflowNodeRefSchema,
  workflowRunChangeSchema,
  workflowRunSchema,
  workflowRunStatusSchema,
  workflowRunTriggeredBySchema,
  workflowRunUsageSchema,
  workflowScheduleSchema,
  workflowSchema,
  workflowTriggerSchema,
  workflowUpdateModeSchema,
  workspaceSchema,
} from "@/schemas/domain"
import type { z } from "zod"

/**
 * Domain type aliases.
 *
 * These types used to be hand-written interfaces. They are now re-exported
 * `z.infer` aliases from the single source of truth in `src/schemas/domain.ts`.
 * Store and composable code that imports from `@/types/domain` keeps working
 * with zero changes because the inferred shapes are structurally identical
 * to the previous interfaces.
 *
 * One minor caveat: per-field `readonly` modifiers (e.g. `readonly id: string`
 * on ITeam) are dropped by `z.infer`. This is a type-level loosening that
 * matters only if code was relying on the compiler to block field mutation —
 * which no call site in this codebase does.
 */

export type BillingPlanKey = z.infer<typeof billingPlanKeySchema>
export type BillingInterval = z.infer<typeof billingIntervalSchema>
export type ITeamBilling = z.infer<typeof teamBillingSchema>

export type ITeam = z.infer<typeof teamSchema>
export type IWorkspace = z.infer<typeof workspaceSchema>
export type IGroup = z.infer<typeof groupSchema>

export type IUserProfile = z.infer<typeof userProfileSchema>
export type IUser = z.infer<typeof userSchema>

export type IUserPreferences = z.infer<typeof userPreferencesSchema>
export type IMembershipPreferences = z.infer<typeof membershipPreferencesSchema>

export type IUsernameClaim = z.infer<typeof usernameClaimSchema>

export type IBotSession = z.infer<typeof botSessionSchema>
export type IBotSessionVisibility = z.infer<typeof botSessionVisibilitySchema>
export type IBotChatRole = z.infer<typeof botChatRoleSchema>
export type IBotSessionMessage = z.infer<typeof botSessionMessageSchema>
export type IBotMessageSegment = z.infer<typeof botMessageSegmentSchema>
export type IBotToolCall = z.infer<typeof botToolCallSchema>

export type IBotModelProvider = z.infer<typeof botAgentProviderSchema>
export type IBotAgentProviderToggles = z.infer<
  typeof botAgentProviderTogglesSchema
>
export type IBotAgentModel = z.infer<typeof botAgentModelSchema>
export type IBotAgentModelToggles = z.infer<typeof botAgentModelTogglesSchema>
export type IBotAgentDefaultMode = z.infer<typeof botAgentDefaultModeSchema>
export type IBotAgentToolToggles = z.infer<typeof botAgentToolTogglesSchema>
export type IBotAgentConfig = z.infer<typeof botAgentConfigSchema>

export type ITeamAgent = z.infer<typeof teamAgentSchema>

// ─── Workflows ──────────────────────────────────────────────────────────────

export type IWorkflow = z.infer<typeof workflowSchema>
export type IWorkflowRun = z.infer<typeof workflowRunSchema>
export type IWorkflowTrigger = z.infer<typeof workflowTriggerSchema>
export type IWorkflowSchedule = z.infer<typeof workflowScheduleSchema>
export type IWorkflowRunStatus = z.infer<typeof workflowRunStatusSchema>
export type IWorkflowUpdateMode = z.infer<typeof workflowUpdateModeSchema>
export type IWorkflowNodeRef = z.infer<typeof workflowNodeRefSchema>
export type IWorkflowRunChange = z.infer<typeof workflowRunChangeSchema>
export type IWorkflowRunTriggeredBy = z.infer<
  typeof workflowRunTriggeredBySchema
>
export type IWorkflowRunUsage = z.infer<typeof workflowRunUsageSchema>

// ─── Custom tools ───────────────────────────────────────────────────────────

export type ICustomToolField = z.infer<typeof customToolFieldSchema>
export type ICustomToolAction = z.infer<typeof customToolActionSchema>
export type ICustomToolActionKind = ICustomToolAction["kind"]
export type ITeamCustomTool = z.infer<typeof teamCustomToolSchema>

// ─── Integrations (agent | tool) ─────────────────────────────────────────────
// Workflows are their own model (`IWorkflow`, above) — a dedicated collection,
// not a member of the integration doc union. The catalog taxonomy
// (`IIntegrationType`) still spans all three for the marketplace seam.

export type IIntegrationType = z.infer<typeof integrationTypeSchema>
export type IIntegrationSource = z.infer<typeof integrationSourceSchema>

export type IAgentIntegrationSpec = z.infer<typeof agentIntegrationSpecSchema>
export type IToolIntegrationSpec = z.infer<typeof toolIntegrationSpecSchema>

/** The integration doc (discriminated by `type`). */
export type IIntegration = z.infer<typeof integrationSchema>
/** Narrowed per-type aliases for call sites that already know the type. */
export type IAgentIntegration = Extract<IIntegration, { type: "agent" }>
export type IToolIntegration = Extract<IIntegration, { type: "tool" }>

export type IAgentIntegrationDraft = z.infer<typeof agentIntegrationDraftSchema>
export type IAgentIntegrationPatch = z.infer<typeof agentIntegrationPatchSchema>
export type IToolIntegrationDraft = z.infer<typeof toolIntegrationDraftSchema>
export type IToolIntegrationPatch = z.infer<typeof toolIntegrationPatchSchema>
