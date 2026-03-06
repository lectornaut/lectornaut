import type { BillingPlanKey, ITeamBilling } from "@/types/domain"
import type { IMembershipRole } from "@/types/membership"

export const BILLING_PLAN_ORDER: readonly BillingPlanKey[] = [
  "personal",
  "professional",
  "business",
  "enterprise",
] as const

export const BILLING_ENTITLED_STATUSES = new Set(["active", "trialing"])

export const BILLING_ACTIVE_LIKE_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
])
const BILLABLE_SEAT_ROLES = new Set<IMembershipRole>([
  "owner",
  "admin",
  "member",
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
  if (typeof billing.status === "string") {
    return BILLING_ENTITLED_STATUSES.has(billing.status)
  }
  return billing.isEntitled === true
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
    quantity: typeof billing?.quantity === "number" ? billing.quantity : null,
    status: billing?.status ?? null,
    currentPeriodEnd: billing?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: billing?.cancelAtPeriodEnd ?? false,
    lastInvoiceId: billing?.lastInvoiceId ?? null,
    lastInvoiceStatus: billing?.lastInvoiceStatus ?? null,
    lastStripeEventId: billing?.lastStripeEventId ?? null,
    lastStripeEventCreated:
      typeof billing?.lastStripeEventCreated === "number"
        ? billing.lastStripeEventCreated
        : null,
    isEntitled: billing?.isEntitled ?? false,
    updatedAt: billing?.updatedAt,
  }
}

export function countBillableSeatsFromMembers(
  members: Array<{ role?: unknown }> | null | undefined
): number {
  if (!members || members.length === 0) return 1
  const count = members.filter((member) => {
    return (
      typeof member.role === "string" &&
      BILLABLE_SEAT_ROLES.has(member.role as IMembershipRole)
    )
  }).length
  return Math.max(count, 1)
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
