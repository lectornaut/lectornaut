import type { BillingPlanKey, ITeamBilling } from "@/types/domain"

export const BILLING_PLAN_ORDER: readonly BillingPlanKey[] = [
  "personal",
  "professional",
  "business",
  "enterprise",
] as const

export const BILLING_ENTITLED_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
])

export const BILLING_ACTIVE_LIKE_STATUSES = new Set([
  ...BILLING_ENTITLED_STATUSES,
  "incomplete",
])

const BILLING_PLAN_RANK = new Map<BillingPlanKey, number>(
  BILLING_PLAN_ORDER.map((planKey, index) => [planKey, index])
)

export function hasActiveLikeBillingStatus(status: unknown): boolean {
  return typeof status === "string" && BILLING_ACTIVE_LIKE_STATUSES.has(status)
}

export function isTeamBillingEntitled(
  billing: Partial<ITeamBilling> | null | undefined
): boolean {
  if (!billing) return false
  if (billing.isEntitled === true) return true
  return (
    typeof billing.status === "string" &&
    BILLING_ENTITLED_STATUSES.has(billing.status)
  )
}

export function normalizeTeamBilling(
  billing: Partial<ITeamBilling> | null | undefined
): ITeamBilling {
  return {
    stripeCustomerId: billing?.stripeCustomerId ?? null,
    stripeSubscriptionId: billing?.stripeSubscriptionId ?? null,
    stripeScheduleId: billing?.stripeScheduleId ?? null,
    planKey: billing?.planKey ?? null,
    interval: billing?.interval ?? null,
    priceId: billing?.priceId ?? null,
    status: billing?.status ?? null,
    currentPeriodEnd: billing?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: billing?.cancelAtPeriodEnd ?? false,
    lastInvoiceId: billing?.lastInvoiceId ?? null,
    lastInvoiceStatus: billing?.lastInvoiceStatus ?? null,
    lastStripeEventId: billing?.lastStripeEventId ?? null,
    isEntitled: billing?.isEntitled ?? false,
    updatedAt: billing?.updatedAt,
  }
}

export function getBillingPlanRank(
  planKey: BillingPlanKey | null | undefined
): number {
  if (!planKey) return -1
  return BILLING_PLAN_RANK.get(planKey) ?? -1
}

export function hasPlanAtLeast(
  currentPlan: BillingPlanKey | null | undefined,
  requiredPlan: BillingPlanKey
): boolean {
  const currentRank = getBillingPlanRank(currentPlan)
  const requiredRank = getBillingPlanRank(requiredPlan)
  if (currentRank < 0 || requiredRank < 0) return false
  return currentRank >= requiredRank
}
