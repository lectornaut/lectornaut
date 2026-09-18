/**
 * The ONE client-side read of a team's AI usage budget. Every surface that
 * shows a limit (Settings → Usage, Settings → Plans, the pricing page) derives
 * from here so they can never disagree:
 *
 *   plan allowance  = PLAN_TOKEN_ALLOWANCES[billing.planKey]   (shared/domain)
 *   team cap        = agent-config `monthlyTokenCap`            (Settings → Usage)
 *   cost cap        = agent-config `monthlyCostCapCents`         (USD cents)
 *   effective limit = resolveEffectiveTokenAllowance(plan, cap) (shared helper,
 *                     the SAME function the server enforces with)
 *   used            = teams/{teamId}/usage/{YYYY-MM}.totalTokens (server-metered)
 *
 * Plan changes need no special handling here: the allowance is read live from
 * `billing.planKey`, which the Stripe webhooks flip — immediately on upgrade,
 * at period end on a scheduled downgrade. The month bucket is calendar-UTC and
 * does not reset on a plan change, which is why `exceedsPlan()` exists: a
 * downgrade whose allowance is below this month's usage stops agents at once.
 */
import { firestore } from "@/modules/firebase"
import { useAgentConfigStore } from "@/stores/agentConfigStore"
import { useAuthStore } from "@/stores/authStore"
import { useBillingStore } from "@/stores/billingStore"
import { useMembershipStore } from "@/stores/membershipStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { useDocumentQuery } from "@/utils/firebase/firebase-query"
import {
  MONTHLY_COST_CAP_MIN_CENTS,
  PLAN_AUDIT_LOG_RETENTION_DAYS,
  PLAN_TOKEN_ALLOWANCES,
  auditLogRetentionCutoff,
  canExportAuditLogsOnPlan,
  getPlanAuditLogRetentionDays,
  getPlanWorkspaceAllowance,
  resolveEffectiveTokenAllowance,
  type BillingPlanKey,
} from "@lectornaut/shared/domain"
import { doc, type DocumentReference } from "firebase/firestore"
import { storeToRefs } from "pinia"
import { computed } from "vue"

export interface TeamUsageDoc {
  /** "YYYY-MM" — written by the server alongside the counters. */
  month?: string
  totalTokens?: number
  inputTokens?: number
  outputTokens?: number
  turnCount?: number
  estimatedCostUsd?: number
}

/** Mirrors `currentUsageMonthKey` (functions/usageMetering.ts): UTC "YYYY-MM". */
export const toUsageMonthKey = (d: Date): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`

/** Plan allowance in tokens; `-1` = unlimited. Unknown plan → most restrictive. */
export const getPlanTokenAllowance = (
  planKey: BillingPlanKey | null | undefined
): number => PLAN_TOKEN_ALLOWANCES[planKey ?? "personal"]

export function useTeamUsage() {
  const { currentTeamId } = storeToRefs(useAuthStore())
  const { planKey } = storeToRefs(useBillingStore())
  const { config } = storeToRefs(useAgentConfigStore())
  const { isOwner, isAdmin } = storeToRefs(useMembershipStore())
  const { workspaces } = storeToRefs(useWorkspaceStore())

  // firestore.rules: usage docs are admin-readable only.
  const canReadUsage = computed(() => isOwner.value || isAdmin.value)

  const monthKey = toUsageMonthKey(new Date())
  const usageRef = computed(() => {
    const id = currentTeamId.value
    if (!id) return null
    return doc(
      firestore,
      `teams/${id}/usage/${monthKey}`
    ) as DocumentReference<TeamUsageDoc>
  })
  const { data: usage, isLoading } = useDocumentQuery(usageRef, {
    enabled: canReadUsage,
  })

  const used = computed(() => usage.value?.totalTokens ?? 0)
  const turnCount = computed(() => usage.value?.turnCount ?? 0)
  const estimatedCostUsd = computed(() => usage.value?.estimatedCostUsd ?? 0)

  const planAllowance = computed(() => getPlanTokenAllowance(planKey.value))
  const teamCap = computed(() => config.value.monthlyTokenCap)
  const effectiveLimit = computed(() =>
    resolveEffectiveTokenAllowance(planAllowance.value, teamCap.value)
  )
  const isUnlimited = computed(() => effectiveLimit.value < 0)
  const percentUsed = computed(() => {
    if (isUnlimited.value || effectiveLimit.value === 0) return 0
    return Math.min(100, (used.value / effectiveLimit.value) * 100)
  })
  const isExhausted = computed(
    () => !isUnlimited.value && used.value >= effectiveLimit.value
  )
  /** A team cap above the plan allowance is inert — the plan allowance wins. */
  const isCapAbovePlan = computed(
    () =>
      teamCap.value !== null &&
      planAllowance.value >= 0 &&
      teamCap.value > planAllowance.value
  )
  const costCapCents = computed(() => config.value.monthlyCostCapCents)
  const costAllowanceUsd = computed(() =>
    costCapCents.value === null ||
    costCapCents.value < MONTHLY_COST_CAP_MIN_CENTS
      ? Number.POSITIVE_INFINITY
      : costCapCents.value / 100
  )
  const costRemainingUsd = computed(() =>
    Math.max(0, costAllowanceUsd.value - estimatedCostUsd.value)
  )
  const isCostLimited = computed(() => Number.isFinite(costAllowanceUsd.value))
  const costPercentUsed = computed(() => {
    if (!isCostLimited.value || costAllowanceUsd.value === 0) return 0
    return Math.min(
      100,
      (estimatedCostUsd.value / costAllowanceUsd.value) * 100
    )
  })

  /** Would this month's usage already exceed `plan`'s allowance? */
  const exceedsPlan = (plan: BillingPlanKey): boolean => {
    const allowance = PLAN_TOKEN_ALLOWANCES[plan]
    return allowance >= 0 && used.value > allowance
  }

  // ── Workspaces per team ──
  // The client list is the caller's participation set. Owners/admins are
  // seeded into every workspace, so for the people who can create one it is
  // the team's full list; the server count is the authority regardless.
  const workspaceCount = computed(() => workspaces.value.length)
  const planWorkspaceAllowance = computed(() =>
    getPlanWorkspaceAllowance(planKey.value)
  )
  const isAtWorkspaceLimit = computed(
    () =>
      planWorkspaceAllowance.value >= 0 &&
      workspaceCount.value >= planWorkspaceAllowance.value
  )

  // ── Audit logs ──
  const auditLogRetentionDays = computed(() =>
    getPlanAuditLogRetentionDays(planKey.value)
  )
  /** Oldest retained timestamp; `null` = unlimited. Recomputed on plan change. */
  const auditLogCutoff = computed(() => auditLogRetentionCutoff(planKey.value))
  const canExportAuditLogs = computed(() =>
    canExportAuditLogsOnPlan(planKey.value)
  )
  /** Would `plan` keep audit logs for a shorter window than today's plan? */
  const shortensAuditLogRetention = (plan: BillingPlanKey): boolean => {
    const next = PLAN_AUDIT_LOG_RETENTION_DAYS[plan]
    const current = auditLogRetentionDays.value
    if (next < 0) return false
    return current < 0 || next < current
  }

  return {
    monthKey,
    canReadUsage,
    isLoading,
    used,
    turnCount,
    estimatedCostUsd,
    planKey,
    planAllowance,
    teamCap,
    effectiveLimit,
    isUnlimited,
    percentUsed,
    isExhausted,
    isCapAbovePlan,
    costCapCents,
    costAllowanceUsd,
    costRemainingUsd,
    isCostLimited,
    costPercentUsed,
    exceedsPlan,
    workspaceCount,
    planWorkspaceAllowance,
    isAtWorkspaceLimit,
    auditLogRetentionDays,
    auditLogCutoff,
    canExportAuditLogs,
    shortensAuditLogRetention,
  }
}
