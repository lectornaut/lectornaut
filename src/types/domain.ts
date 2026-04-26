import type {
  billingIntervalSchema,
  billingPlanKeySchema,
  botChatRoleSchema,
  botSessionMessageSchema,
  botSessionSchema,
  botSessionVisibilitySchema,
  membershipPreferencesSchema,
  teamBillingSchema,
  teamSchema,
  userPreferencesSchema,
  userProfileSchema,
  userSchema,
  usernameClaimSchema,
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

export type IUserProfile = z.infer<typeof userProfileSchema>
export type IUser = z.infer<typeof userSchema>

export type IUserPreferences = z.infer<typeof userPreferencesSchema>
export type IMembershipPreferences = z.infer<typeof membershipPreferencesSchema>

export type IUsernameClaim = z.infer<typeof usernameClaimSchema>

export type IBotSession = z.infer<typeof botSessionSchema>
export type IBotSessionVisibility = z.infer<typeof botSessionVisibilitySchema>
export type IBotChatRole = z.infer<typeof botChatRoleSchema>
export type IBotSessionMessage = z.infer<typeof botSessionMessageSchema>
