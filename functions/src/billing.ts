import * as logger from "firebase-functions/logger"
import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore"
import {
  CallableRequest,
  HttpsError,
  onCall,
  onRequest,
} from "firebase-functions/v2/https"
import { onSchedule } from "firebase-functions/v2/scheduler"
import { createHash } from "node:crypto"
import Stripe from "stripe"
import {
  BillingInterval,
  PlanKey,
  getPlanRank,
  getPriceId,
  mapPriceIdToPlan,
  resolveBillingCatalogFromStripe,
} from "./billingConfig.js"
import { admin, db } from "./firebase.js"
import { makeEventIdempotencyKey } from "./idempotency.js"
import { can } from "./permissions.js"
import { CALLABLE_OPTS, SCHEDULED_OPTS, TRIGGER_OPTS } from "./runtimeConfig.js"
import { stripeSecretKey, stripeWebhookSecret } from "./secrets.js"
import { Capabilities, IMembershipRole, isMembershipRole } from "./types.js"

type PlanChangeTiming = "immediate" | "period_end"
type StripeEventMeta = {
  id: string
  created: number
  type: string
}

type TeamBillingData = {
  stripeCustomerId?: string | null
  stripeSubscriptionId?: string | null
  stripeScheduleId?: string | null
  planKey?: PlanKey | null
  interval?: BillingInterval | null
  priceId?: string | null
  quantity?: number | null
  status?: string | null
  currentPeriodEnd?: number | null
  cancelAtPeriodEnd?: boolean
  lastInvoiceId?: string | null
  lastInvoiceStatus?: string | null
  lastStripeEventId?: string | null
  lastStripeEventCreated?: number | null
  isEntitled?: boolean
}

interface BillingSummary {
  status: string | null
  currentPeriodEnd: number | null
  cancelAtPeriodEnd: boolean
  priceId: string | null
  quantity: number | null
}

interface TeamBillingContext {
  teamId: string
  uid: string
  teamRole: IMembershipRole
  teamRef: admin.firestore.DocumentReference
  teamData: Record<string, unknown>
}

interface StripeSubscriptionReference {
  subscription: Stripe.Subscription
  customerId: string
}

const STRIPE_IDEMPOTENCY_BUCKET_MS = 5 * 60 * 1000
const STRIPE_WEBHOOK_LOCK_TTL_MS = 30 * 24 * 60 * 60 * 1000
const STRIPE_WEBHOOK_STALE_PROCESSING_MS = 10 * 60 * 1000
const BILLING_RETURN_PATHNAME = "/pricing"

const PLAN_KEYS: PlanKey[] = [
  "personal",
  "professional",
  "business",
  "enterprise",
]
const BILLING_INTERVALS: BillingInterval[] = ["month", "year"]
const BILLABLE_SEAT_ROLES: readonly IMembershipRole[] = [
  "owner",
  "admin",
  "member",
]
const BILLABLE_SEAT_ROLE_SET = new Set<IMembershipRole>(BILLABLE_SEAT_ROLES)
const BILLING_RECONCILE_BATCH_SIZE = 100
const BILLING_RECONCILE_STATE_DOC = "systemJobs/billingSeatReconciler"

const activeLikeStatuses = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
])
const entitledStatuses = new Set(["active", "trialing"])

let stripeClient: Stripe | null = null

function getStripeClient(): Stripe {
  if (!stripeClient) {
    const secret = stripeSecretKey.value()
    if (!secret) {
      throw new HttpsError(
        "failed-precondition",
        "Stripe secret key is not configured."
      )
    }
    stripeClient = new Stripe(secret)
  }
  return stripeClient
}

function assertAuthenticated(
  request: CallableRequest
): asserts request is CallableRequest & {
  auth: NonNullable<CallableRequest["auth"]>
} {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    )
  }
}

function getObject(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") {
    return {}
  }
  return data as Record<string, unknown>
}

function getString(
  data: Record<string, unknown>,
  field: string
): string | null {
  const value = data[field]
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function assertString(data: Record<string, unknown>, field: string): string {
  const value = getString(data, field)
  if (!value) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be a non-empty string.`
    )
  }
  return value
}

function getBillingAppOrigin(): string {
  if (process.env.FUNCTIONS_EMULATOR === "true") {
    return "http://127.0.0.1:5173"
  }

  const projectId = process.env.GCLOUD_PROJECT
  if (!projectId) {
    throw new HttpsError(
      "failed-precondition",
      "Unable to resolve billing return URL origin."
    )
  }

  return `https://${projectId}.web.app`
}

function buildBillingReturnUrl(): string {
  const url = new URL(getBillingAppOrigin())
  url.pathname = BILLING_RETURN_PATHNAME
  return url.toString()
}

function assertPlanKey(data: Record<string, unknown>, field: string): PlanKey {
  const value = assertString(data, field)
  if (!PLAN_KEYS.includes(value as PlanKey)) {
    throw new HttpsError("invalid-argument", `${field} is not a valid plan.`)
  }
  return value as PlanKey
}

function assertBillingInterval(
  data: Record<string, unknown>,
  field: string
): BillingInterval {
  const value = assertString(data, field)
  if (!BILLING_INTERVALS.includes(value as BillingInterval)) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be either "month" or "year".`
    )
  }
  return value as BillingInterval
}

function assertPlanTiming(
  data: Record<string, unknown>,
  field: string
): PlanChangeTiming | null {
  const value = getString(data, field)
  if (!value) return null
  if (value !== "immediate" && value !== "period_end") {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be "immediate" or "period_end".`
    )
  }
  return value
}

function getEnvironmentLabel(): string {
  if (process.env.FUNCTIONS_EMULATOR === "true") return "emulator"
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT
  return "unknown"
}

function buildStripeIdempotencyKey(
  action: string,
  uid: string,
  teamId: string,
  target: Record<string, unknown>
): string {
  const timeBucket = Math.floor(Date.now() / STRIPE_IDEMPOTENCY_BUCKET_MS)
  const payload = JSON.stringify({
    action,
    uid,
    teamId,
    target,
    timeBucket,
  })
  const hash = createHash("sha256").update(payload).digest("hex")
  return `lectornaut_${hash}`
}

function buildStableTeamIdempotencyKey(action: string, teamId: string): string {
  const hash = createHash("sha256")
    .update(JSON.stringify({ action, teamId }))
    .digest("hex")
  return `lectornaut_${hash}`
}

function getTeamBillingData(
  teamData: Record<string, unknown>
): TeamBillingData {
  const billingRaw = teamData.billing
  if (!billingRaw || typeof billingRaw !== "object") {
    return {}
  }
  return billingRaw as TeamBillingData
}

function getSubscriptionQuantity(subscription: Stripe.Subscription): number {
  const item =
    subscription.items.data.find((candidate) => !!candidate.price) ??
    subscription.items.data[0]
  return item?.quantity ?? 1
}

function summarizeSubscription(
  subscription: Stripe.Subscription,
  overridePriceId?: string | null
): BillingSummary {
  const item =
    subscription.items.data.find((candidate) => !!candidate.price) ??
    subscription.items.data[0]
  const itemPriceId = item?.price?.id ?? null

  return {
    status: subscription.status,
    currentPeriodEnd: item?.current_period_end ?? null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    priceId: overridePriceId ?? itemPriceId,
    quantity: item?.quantity ?? 1,
  }
}

function isEntitledStatus(status: string | null | undefined): boolean {
  return !!status && entitledStatuses.has(status)
}

function normalizeScheduleId(
  schedule: string | Stripe.SubscriptionSchedule | null
): string | null {
  if (!schedule) return null
  return typeof schedule === "string" ? schedule : schedule.id
}

function isFirestoreNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const code = (error as { code?: unknown }).code
  return code === 5 || code === "5" || code === "not-found"
}

function toBillingFieldUpdates(
  billingPatch: Record<string, unknown>
): Record<string, unknown> {
  const updates: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(billingPatch)) {
    updates[`billing.${field}`] = value
  }
  return updates
}

async function patchTeamBillingIfExists(args: {
  teamRef: admin.firestore.DocumentReference
  teamId: string
  source: string
  billingPatch: Record<string, unknown>
  context?: Record<string, unknown>
}): Promise<boolean> {
  const { teamRef, teamId, source, billingPatch, context = {} } = args
  try {
    await teamRef.update(toBillingFieldUpdates(billingPatch))
    return true
  } catch (error) {
    if (isFirestoreNotFoundError(error)) {
      logger.info("[billing] Skipping billing patch for missing team", {
        teamId,
        source,
        ...context,
      })
      return false
    }
    throw error
  }
}

function getPrimarySubscriptionItem(
  subscription: Stripe.Subscription
): Stripe.SubscriptionItem {
  const item = subscription.items.data.find((candidate) => !!candidate.price)
  if (!item) {
    throw new HttpsError(
      "failed-precondition",
      "Subscription does not have a billable item."
    )
  }
  return item
}

function normalizeQuantity(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null
  }
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : null
}

function normalizeEventCreatedSeconds(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : null
}

function normalizeEventId(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeMembershipRole(value: unknown): IMembershipRole | null {
  return isMembershipRole(value) ? value : null
}

function isBillableRole(role: IMembershipRole | null): boolean {
  return !!role && BILLABLE_SEAT_ROLE_SET.has(role)
}

function hasBillableRoleTransition(
  beforeRole: IMembershipRole | null,
  afterRole: IMembershipRole | null
): boolean {
  return isBillableRole(beforeRole) !== isBillableRole(afterRole)
}

function buildQuantitySyncIdempotencyKey(args: {
  action: string
  teamId: string
  subscriptionId: string
  quantity: number
  source: string
}): string {
  const hash = createHash("sha256").update(JSON.stringify(args)).digest("hex")
  return `lectornaut_${hash}`
}

async function countBillableSeats(teamId: string): Promise<number> {
  const aggregate = await db
    .collection(`teams/${teamId}/memberships`)
    .where("role", "in", [...BILLABLE_SEAT_ROLES])
    .count()
    .get()

  const count = aggregate.data().count ?? 0
  return Math.max(count, 1)
}

async function getTeamBillingContext(
  request: CallableRequest,
  teamId: string,
  options: { requireBillingPermission: boolean }
): Promise<TeamBillingContext> {
  assertAuthenticated(request)
  const uid = request.auth.uid

  const membershipRef = db.doc(`teams/${teamId}/memberships/${uid}`)
  const membershipSnap = await membershipRef.get()
  if (!membershipSnap.exists) {
    throw new HttpsError("permission-denied", "User is not a team member.")
  }

  const teamRole = membershipSnap.data()?.role as IMembershipRole | undefined
  if (!teamRole) {
    throw new HttpsError(
      "permission-denied",
      "Team membership role is missing."
    )
  }

  if (
    options.requireBillingPermission &&
    !can(uid, Capabilities.MANAGE_BILLING, {
      scope: "team",
      teamRole,
    })
  ) {
    throw new HttpsError(
      "permission-denied",
      "You do not have permission to manage billing for this team."
    )
  }

  const teamRef = db.doc(`teams/${teamId}`)
  const teamSnap = await teamRef.get()
  if (!teamSnap.exists) {
    throw new HttpsError("not-found", "Team not found.")
  }

  return {
    teamId,
    uid,
    teamRole,
    teamRef,
    teamData: teamSnap.data() as Record<string, unknown>,
  }
}

async function ensureStripeCustomer(
  stripe: Stripe,
  context: TeamBillingContext,
  userEmail: string | null
): Promise<string> {
  const latestTeamSnap = await context.teamRef.get()
  const latestTeamData = (latestTeamSnap.data() ?? context.teamData) as Record<
    string,
    unknown
  >
  const existingCustomerId = getTeamBillingData(latestTeamData).stripeCustomerId
  if (existingCustomerId) {
    return existingCustomerId
  }

  const idempotencyKey = buildStableTeamIdempotencyKey(
    "customer.create",
    context.teamId
  )

  const teamName =
    typeof latestTeamData.name === "string" ? latestTeamData.name : undefined

  const customer = await stripe.customers.create(
    {
      email: userEmail ?? undefined,
      name: teamName,
      metadata: {
        teamId: context.teamId,
        environment: getEnvironmentLabel(),
      },
    },
    { idempotencyKey }
  )

  const persistedCustomerId = await db.runTransaction(async (transaction) => {
    const teamSnap = await transaction.get(context.teamRef)
    if (!teamSnap.exists) {
      throw new HttpsError("not-found", "Team not found.")
    }

    const currentTeamData = teamSnap.data() as Record<string, unknown>
    const currentCustomerId =
      getTeamBillingData(currentTeamData).stripeCustomerId ?? null
    if (currentCustomerId) {
      return currentCustomerId
    }

    transaction.set(
      context.teamRef,
      {
        billing: {
          stripeCustomerId: customer.id,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    )

    return customer.id
  })

  if (persistedCustomerId !== customer.id) {
    logger.warn(
      "Stripe customer already existed when persisting team billing",
      {
        teamId: context.teamId,
        createdCustomerId: customer.id,
        persistedCustomerId,
      }
    )
  }

  return persistedCustomerId
}

function isStripeResourceMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const code = (error as { code?: unknown }).code
  return code === "resource_missing"
}

function getCustomerMetadataTeamId(
  customer: Stripe.Customer | Stripe.DeletedCustomer
): string | null {
  if ("deleted" in customer) return null
  if (typeof customer.metadata.teamId === "string") {
    const teamId = customer.metadata.teamId.trim()
    return teamId.length > 0 ? teamId : null
  }
  return null
}

async function resolveCustomerMetadataTeamId(
  stripe: Stripe,
  customerId: string
): Promise<string | null> {
  try {
    const customer = await stripe.customers.retrieve(customerId)
    return getCustomerMetadataTeamId(customer)
  } catch (error) {
    if (isStripeResourceMissingError(error)) return null
    throw error
  }
}

async function isSubscriptionReferenceValidForTeam(args: {
  stripe: Stripe
  teamId: string
  customerId: string
  billingCustomerId: string | null
  subscription: Stripe.Subscription
  source: string
}): Promise<boolean> {
  const {
    stripe,
    teamId,
    customerId,
    billingCustomerId,
    subscription,
    source,
  } = args

  if (billingCustomerId && billingCustomerId !== customerId) {
    logger.error("[billing] Stripe customer mismatch for team", {
      teamId,
      source,
      billingCustomerId,
      resolvedCustomerId: customerId,
      subscriptionId: subscription.id,
    })
    return false
  }

  const subscriptionTeamId = getTeamIdFromSubscription(subscription)
  if (subscriptionTeamId && subscriptionTeamId !== teamId) {
    logger.error("[billing] Stripe subscription metadata team mismatch", {
      teamId,
      source,
      subscriptionId: subscription.id,
      subscriptionTeamId,
    })
    return false
  }

  try {
    const customerTeamId = await resolveCustomerMetadataTeamId(
      stripe,
      customerId
    )
    if (customerTeamId && customerTeamId !== teamId) {
      logger.error("[billing] Stripe customer metadata team mismatch", {
        teamId,
        source,
        customerId,
        customerTeamId,
        subscriptionId: subscription.id,
      })
      return false
    }
  } catch (error) {
    logger.warn("[billing] Unable to validate Stripe customer ownership", {
      teamId,
      source,
      customerId,
      subscriptionId: subscription.id,
      message: error instanceof Error ? error.message : String(error),
    })
    return false
  }

  return true
}

async function resolveTeamSubscriptionFromBillingData(
  stripe: Stripe,
  teamId: string,
  billing: TeamBillingData,
  customerIdFallback?: string | null
): Promise<StripeSubscriptionReference | null> {
  const preferredSubscriptionId = billing.stripeSubscriptionId
  const billingCustomerId = billing.stripeCustomerId ?? null
  const customerId = billingCustomerId ?? customerIdFallback ?? null

  if (!customerId && !preferredSubscriptionId) {
    return null
  }

  if (preferredSubscriptionId) {
    try {
      const preferred = await stripe.subscriptions.retrieve(
        preferredSubscriptionId
      )
      if (!["canceled", "incomplete_expired"].includes(preferred.status)) {
        const preferredCustomerId =
          typeof preferred.customer === "string"
            ? preferred.customer
            : (customerId ?? null)

        if (preferredCustomerId) {
          const valid = await isSubscriptionReferenceValidForTeam({
            stripe,
            teamId,
            customerId: preferredCustomerId,
            billingCustomerId,
            subscription: preferred,
            source: "preferred_subscription",
          })
          if (valid) {
            return { subscription: preferred, customerId: preferredCustomerId }
          }
        }
      }
    } catch (error) {
      logger.warn("Unable to retrieve preferred Stripe subscription", {
        teamId,
        subscriptionId: preferredSubscriptionId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (!customerId) {
    return null
  }

  const listed = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 20,
  })

  const candidates = listed.data
    .filter(
      (subscription) =>
        !["canceled", "incomplete_expired"].includes(subscription.status)
    )
    .sort((left, right) => right.created - left.created)

  for (const candidate of candidates) {
    const valid = await isSubscriptionReferenceValidForTeam({
      stripe,
      teamId,
      customerId,
      billingCustomerId,
      subscription: candidate,
      source: "list_by_customer",
    })
    if (valid) {
      return { subscription: candidate, customerId }
    }
  }

  return null
}

async function resolveTeamSubscription(
  stripe: Stripe,
  context: TeamBillingContext,
  customerId: string
): Promise<StripeSubscriptionReference | null> {
  const billing = getTeamBillingData(context.teamData)
  return resolveTeamSubscriptionFromBillingData(
    stripe,
    context.teamId,
    billing,
    customerId
  )
}

function resolvePlanChangeTiming(
  explicitTiming: PlanChangeTiming | null,
  currentPlanKey: PlanKey,
  targetPlanKey: PlanKey
): PlanChangeTiming {
  if (explicitTiming) return explicitTiming
  const isDowngrade = getPlanRank(targetPlanKey) < getPlanRank(currentPlanKey)
  return isDowngrade ? "period_end" : "immediate"
}

async function releaseSubscriptionSchedule(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  idempotencyKey: string
): Promise<void> {
  const scheduleId = normalizeScheduleId(subscription.schedule)
  if (!scheduleId) return
  await stripe.subscriptionSchedules.release(scheduleId, {}, { idempotencyKey })
}

async function schedulePlanChangeAtPeriodEnd(args: {
  stripe: Stripe
  teamId: string
  uid: string
  subscription: Stripe.Subscription
  quantity: number
  targetPriceId: string
  targetPlanKey: PlanKey
  targetInterval: BillingInterval
}): Promise<string> {
  const {
    stripe,
    teamId,
    uid,
    subscription,
    quantity,
    targetPriceId,
    targetPlanKey,
    targetInterval,
  } = args

  const primaryItem = getPrimarySubscriptionItem(subscription)
  const currentPriceId = primaryItem.price.id

  const currentPeriodStart = primaryItem.current_period_start
  const currentPeriodEnd = primaryItem.current_period_end

  const scheduleId = normalizeScheduleId(subscription.schedule)
  const schedule = scheduleId
    ? await stripe.subscriptionSchedules.retrieve(scheduleId)
    : await stripe.subscriptionSchedules.create(
        {
          from_subscription: subscription.id,
        },
        {
          idempotencyKey: buildStripeIdempotencyKey(
            "subscription.schedule.create",
            uid,
            teamId,
            {
              subscriptionId: subscription.id,
            }
          ),
        }
      )

  const updated = await stripe.subscriptionSchedules.update(
    schedule.id,
    {
      end_behavior: "release",
      metadata: {
        teamId,
        targetPlanKey,
        targetInterval,
      },
      phases: [
        {
          items: [{ price: currentPriceId, quantity }],
          start_date: currentPeriodStart,
          end_date: currentPeriodEnd,
          proration_behavior: "none",
        },
        {
          items: [{ price: targetPriceId, quantity }],
          start_date: currentPeriodEnd,
          proration_behavior: "none",
        },
      ],
    },
    {
      idempotencyKey: buildStripeIdempotencyKey(
        "subscription.schedule.update",
        uid,
        teamId,
        {
          subscriptionId: subscription.id,
          targetPriceId,
        }
      ),
    }
  )

  return updated.id
}

function getScheduleItemPriceId(
  item: Stripe.SubscriptionSchedule.Phase.Item
): string | null {
  if (typeof item.price === "string") return item.price
  if (item.price && typeof item.price === "object" && "id" in item.price) {
    return typeof item.price.id === "string" ? item.price.id : null
  }
  return null
}

function buildSchedulePhasesWithQuantity(
  schedule: Stripe.SubscriptionSchedule,
  quantity: number
): Stripe.SubscriptionScheduleUpdateParams["phases"] {
  return schedule.phases.map((phase) => {
    const items = phase.items
      .map((item) => {
        const price = getScheduleItemPriceId(item)
        if (!price) return null
        return {
          price,
          quantity,
        }
      })
      .filter(
        (item): item is { price: string; quantity: number } => item !== null
      )

    const mappedPhase: Stripe.SubscriptionScheduleUpdateParams.Phase = {
      start_date: phase.start_date,
      items,
      proration_behavior: phase.proration_behavior ?? "none",
    }

    if (phase.end_date) {
      mappedPhase.end_date = phase.end_date
    }

    return mappedPhase
  })
}

async function syncScheduleQuantityToSeats(args: {
  stripe: Stripe
  teamId: string
  subscription: Stripe.Subscription
  quantity: number
  source: string
}): Promise<string | null> {
  const { stripe, teamId, subscription, quantity, source } = args
  const scheduleId = normalizeScheduleId(subscription.schedule)
  if (!scheduleId) return null

  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId)
  if (["released", "canceled", "completed"].includes(schedule.status)) {
    return schedule.id
  }
  const needsScheduleUpdate = schedule.phases.some((phase) =>
    phase.items.some((item) => (item.quantity ?? 1) !== quantity)
  )

  if (!needsScheduleUpdate) {
    return schedule.id
  }

  const phases = buildSchedulePhasesWithQuantity(schedule, quantity) ?? []
  const hasEmptyPhase = phases.some((phase) => (phase.items?.length ?? 0) === 0)
  if (phases.length === 0 || hasEmptyPhase) {
    logger.warn(
      "[billing.quantity.sync] Skipping schedule quantity sync due to empty phase items",
      {
        teamId,
        subscriptionId: subscription.id,
        scheduleId: schedule.id,
        source,
      }
    )
    return schedule.id
  }

  const updated = await stripe.subscriptionSchedules.update(
    schedule.id,
    {
      end_behavior: schedule.end_behavior ?? "release",
      metadata: {
        ...schedule.metadata,
        teamId,
      },
      phases,
    },
    {
      idempotencyKey: buildQuantitySyncIdempotencyKey({
        action: "subscription.schedule.quantity.sync",
        teamId,
        subscriptionId: subscription.id,
        quantity,
        source,
      }),
    }
  )

  return updated.id
}

async function syncSubscriptionQuantityToSeats(args: {
  stripe: Stripe
  teamId: string
  source: string
  teamData?: Record<string, unknown>
  prorationBehavior?: Stripe.SubscriptionUpdateParams.ProrationBehavior
}): Promise<{
  seatCount: number
  stripeQuantity: number | null
  subscriptionId: string | null
  updated: boolean
}> {
  const {
    stripe,
    teamId,
    source,
    prorationBehavior = "create_prorations",
  } = args
  const teamRef = db.doc(`teams/${teamId}`)
  const teamData =
    args.teamData ?? ((await teamRef.get()).data() as Record<string, unknown>)

  if (!teamData) {
    logger.warn("[billing.quantity.sync] Team not found for quantity sync", {
      teamId,
      source,
    })
    return {
      seatCount: 1,
      stripeQuantity: null,
      subscriptionId: null,
      updated: false,
    }
  }

  const billing = getTeamBillingData(teamData)
  const seatCount = await countBillableSeats(teamId)
  const subscriptionRef = await resolveTeamSubscriptionFromBillingData(
    stripe,
    teamId,
    billing,
    billing.stripeCustomerId
  )

  if (
    !subscriptionRef ||
    !activeLikeStatuses.has(subscriptionRef.subscription.status)
  ) {
    await patchTeamBillingIfExists({
      teamRef,
      teamId,
      source,
      billingPatch: {
        quantity: seatCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      context: { reason: "no_active_subscription" },
    })
    logger.info("[billing.quantity.sync] No active subscription to sync", {
      teamId,
      source,
      seatCount,
    })
    return {
      seatCount,
      stripeQuantity: null,
      subscriptionId: null,
      updated: false,
    }
  }

  let { subscription } = subscriptionRef
  const primaryItem = getPrimarySubscriptionItem(subscription)
  const currentQuantity = primaryItem.quantity ?? 1
  let updated = false

  if (currentQuantity !== seatCount) {
    subscription = await stripe.subscriptions.update(
      subscription.id,
      {
        proration_behavior: prorationBehavior,
        items: [
          {
            id: primaryItem.id,
            quantity: seatCount,
          },
        ],
      },
      {
        idempotencyKey: buildQuantitySyncIdempotencyKey({
          action: "subscription.quantity.sync",
          teamId,
          subscriptionId: subscription.id,
          quantity: seatCount,
          source,
        }),
      }
    )
    updated = true
  }

  const scheduleId = await syncScheduleQuantityToSeats({
    stripe,
    teamId,
    subscription,
    quantity: seatCount,
    source,
  })

  const summary = summarizeSubscription(subscription)
  const persistedQuantity = summary.quantity ?? seatCount

  await patchTeamBillingIfExists({
    teamRef,
    teamId,
    source,
    billingPatch: {
      stripeCustomerId: subscriptionRef.customerId,
      stripeSubscriptionId: subscription.id,
      stripeScheduleId:
        scheduleId ?? normalizeScheduleId(subscription.schedule),
      planKey: billing.planKey ?? null,
      interval: billing.interval ?? null,
      priceId: summary.priceId,
      status: summary.status,
      currentPeriodEnd: summary.currentPeriodEnd,
      cancelAtPeriodEnd: summary.cancelAtPeriodEnd,
      isEntitled: isEntitledStatus(summary.status),
      quantity: persistedQuantity,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  })

  logger.info("[billing.quantity.sync] Quantity sync completed", {
    teamId,
    source,
    subscriptionId: subscription.id,
    fromQuantity: currentQuantity,
    toQuantity: persistedQuantity,
    updated,
  })

  return {
    seatCount,
    stripeQuantity: persistedQuantity,
    subscriptionId: subscription.id,
    updated,
  }
}

function getTeamIdFromSubscription(
  subscription: Stripe.Subscription
): string | null {
  if (typeof subscription.metadata.teamId === "string") {
    const teamId = subscription.metadata.teamId.trim()
    return teamId.length > 0 ? teamId : null
  }
  return null
}

async function findTeamIdByBillingField(
  field: "billing.stripeCustomerId" | "billing.stripeSubscriptionId",
  value: string
): Promise<string | null> {
  const teamsSnap = await db
    .collection("teams")
    .where(field, "==", value)
    .limit(1)
    .get()

  if (teamsSnap.empty) return null
  return teamsSnap.docs[0].id
}

async function resolveTeamIdForInvoice(
  stripe: Stripe,
  invoice: Stripe.Invoice
): Promise<string | null> {
  const subscriptionId = getInvoiceSubscriptionId(invoice)
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : null

  if (subscriptionId) {
    const teamIdBySubscription = await findTeamIdByBillingField(
      "billing.stripeSubscriptionId",
      subscriptionId
    )
    if (teamIdBySubscription) return teamIdBySubscription
  }

  if (customerId) {
    const teamIdByCustomer = await findTeamIdByBillingField(
      "billing.stripeCustomerId",
      customerId
    )
    if (teamIdByCustomer) return teamIdByCustomer

    try {
      const customer = await stripe.customers.retrieve(customerId)
      if (
        !("deleted" in customer) &&
        typeof customer.metadata.teamId === "string"
      ) {
        const teamId = customer.metadata.teamId.trim()
        if (teamId.length > 0) {
          return teamId
        }
      }
    } catch (error) {
      logger.warn("Unable to resolve invoice customer for team mapping", {
        customerId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return null
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacySubscription = (invoice as { subscription?: unknown })
    .subscription
  if (typeof legacySubscription === "string") {
    return legacySubscription
  }
  if (
    legacySubscription &&
    typeof legacySubscription === "object" &&
    typeof (legacySubscription as { id?: unknown }).id === "string"
  ) {
    return (legacySubscription as { id: string }).id
  }

  const subscription = invoice.parent?.subscription_details?.subscription
  if (typeof subscription === "string") return subscription
  if (subscription && typeof subscription === "object") {
    return typeof subscription.id === "string" ? subscription.id : null
  }
  return null
}

async function markWebhookEventProcessing(eventId: string): Promise<boolean> {
  const lockRef = db
    .collection("functionEventLocks")
    .doc(makeEventIdempotencyKey("stripeWebhook", eventId))
  const nowMs = Date.now()

  return db.runTransaction(async (transaction) => {
    const lockSnap = await transaction.get(lockRef)
    const lockData = lockSnap.data() as
      | { status?: string; updatedAtMs?: number }
      | undefined
    const status = lockData?.status
    const updatedAtMs = lockData?.updatedAtMs ?? 0
    const isActiveProcessing =
      status === "processing" &&
      Date.now() - updatedAtMs < STRIPE_WEBHOOK_STALE_PROCESSING_MS

    if (status === "done" || isActiveProcessing) {
      return false
    }

    transaction.set(
      lockRef,
      {
        status: "processing",
        updatedAtMs: nowMs,
        expiresAt: admin.firestore.Timestamp.fromMillis(
          nowMs + STRIPE_WEBHOOK_LOCK_TTL_MS
        ),
        lastError: null,
      },
      { merge: true }
    )

    return true
  })
}

async function completeWebhookEventProcessing(
  eventId: string,
  status: "done" | "error",
  lastError: string | null
): Promise<void> {
  const lockRef = db
    .collection("functionEventLocks")
    .doc(makeEventIdempotencyKey("stripeWebhook", eventId))
  const nowMs = Date.now()
  await lockRef.set(
    {
      status,
      updatedAtMs: nowMs,
      expiresAt: admin.firestore.Timestamp.fromMillis(
        nowMs + STRIPE_WEBHOOK_LOCK_TTL_MS
      ),
      lastError,
    },
    { merge: true }
  )
}

async function cleanupExpiredStripeWebhookLocks(
  options: { batchSize?: number } = {}
): Promise<number> {
  const batchSize = Math.max(1, Math.min(450, options.batchSize ?? 450))
  const now = admin.firestore.Timestamp.now()
  let deleted = 0

  while (true) {
    const staleLocks = await db
      .collection("functionEventLocks")
      .where("expiresAt", "<", now)
      .limit(batchSize)
      .get()

    if (staleLocks.empty) break

    const batch = db.batch()
    staleLocks.docs.forEach((doc) => batch.delete(doc.ref))
    await batch.commit()
    deleted += staleLocks.size

    if (staleLocks.size < batchSize) break
  }

  return deleted
}

async function patchTeamBillingFromWebhookEventIfFresh(args: {
  teamId: string
  source: string
  event: StripeEventMeta
  billingPatch: Record<string, unknown>
  context?: Record<string, unknown>
}): Promise<boolean> {
  const { teamId, source, event, billingPatch, context = {} } = args
  const teamRef = db.doc(`teams/${teamId}`)
  const eventCreated = normalizeEventCreatedSeconds(event.created)
  if (!eventCreated) {
    logger.warn("[billing.webhook] Invalid Stripe event created timestamp", {
      teamId,
      source,
      eventId: event.id,
      eventType: event.type,
    })
    return false
  }

  try {
    return await db.runTransaction(async (transaction) => {
      const teamSnap = await transaction.get(teamRef)
      if (!teamSnap.exists) {
        logger.info("[billing] Skipping billing patch for missing team", {
          teamId,
          source,
          eventId: event.id,
          eventType: event.type,
          ...context,
        })
        return false
      }

      const teamData = teamSnap.data() as Record<string, unknown>
      const teamBilling = getTeamBillingData(teamData)
      const latestEventCreated = normalizeEventCreatedSeconds(
        teamBilling.lastStripeEventCreated
      )
      const latestEventId = normalizeEventId(teamBilling.lastStripeEventId)

      const isOlderTimestamp =
        latestEventCreated !== null && latestEventCreated > eventCreated
      const isSameSecondButOlderId =
        latestEventCreated !== null &&
        latestEventCreated === eventCreated &&
        latestEventId !== null &&
        latestEventId.localeCompare(event.id) > 0

      if (isOlderTimestamp || isSameSecondButOlderId) {
        logger.info("[billing.webhook] Ignored stale Stripe event", {
          teamId,
          source,
          eventId: event.id,
          eventType: event.type,
          eventCreated,
          latestEventCreated,
          latestEventId,
          reason: isOlderTimestamp
            ? "older_created_timestamp"
            : "same_second_event_id_tiebreak",
          ...context,
        })
        return false
      }

      transaction.set(
        teamRef,
        {
          billing: {
            ...billingPatch,
            lastStripeEventId: event.id,
            lastStripeEventCreated: eventCreated,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        { merge: true }
      )
      return true
    })
  } catch (error) {
    if (isFirestoreNotFoundError(error)) {
      logger.info("[billing] Skipping billing patch for missing team", {
        teamId,
        source,
        eventId: event.id,
        eventType: event.type,
        ...context,
      })
      return false
    }
    throw error
  }
}

function getCheckoutSessionTeamId(
  session: Stripe.Checkout.Session
): string | null {
  if (typeof session.metadata?.teamId === "string") {
    const teamId = session.metadata.teamId.trim()
    if (teamId) return teamId
  }
  return null
}

function getCheckoutSessionSubscriptionId(
  session: Stripe.Checkout.Session
): string | null {
  if (typeof session.subscription === "string") return session.subscription
  if (
    session.subscription &&
    typeof session.subscription === "object" &&
    typeof session.subscription.id === "string"
  ) {
    return session.subscription.id
  }
  return null
}

async function applySubscriptionEvent(
  stripe: Stripe,
  event: StripeEventMeta,
  subscription: Stripe.Subscription
): Promise<void> {
  const teamIdFromMetadata = getTeamIdFromSubscription(subscription)
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : null

  const teamId =
    teamIdFromMetadata ??
    (customerId
      ? await findTeamIdByBillingField("billing.stripeCustomerId", customerId)
      : null)

  if (!teamId) {
    logger.warn("Unable to map subscription webhook event to a team", {
      eventId: event.id,
      eventType: event.type,
      subscriptionId: subscription.id,
    })
    return
  }
  const teamRef = db.doc(`teams/${teamId}`)
  const teamSnap = await teamRef.get()
  if (!teamSnap.exists) {
    logger.info("Skipping subscription webhook event for deleted team", {
      eventId: event.id,
      eventType: event.type,
      teamId,
      subscriptionId: subscription.id,
    })
    return
  }
  const teamData = teamSnap.data() as Record<string, unknown>

  const primaryItem =
    subscription.items.data.length > 0
      ? getPrimarySubscriptionItem(subscription)
      : null
  const priceId = primaryItem?.price?.id ?? null
  let quantity = getSubscriptionQuantity(subscription)
  let planInfo: { planKey: PlanKey; interval: BillingInterval } | null = null

  if (priceId) {
    try {
      planInfo = await mapPriceIdToPlan(stripe, priceId)
    } catch (error) {
      logger.warn(
        "Unable to resolve Stripe lookup_key for subscription price",
        {
          eventId: event.id,
          eventType: event.type,
          teamId,
          priceId,
          message: error instanceof Error ? error.message : String(error),
        }
      )
    }
  }

  if (activeLikeStatuses.has(subscription.status)) {
    const seatCount = await countBillableSeats(teamId)
    if (quantity !== seatCount) {
      const syncResult = await syncSubscriptionQuantityToSeats({
        stripe,
        teamId,
        source: "webhook.subscription",
        teamData,
      })
      quantity = syncResult.stripeQuantity ?? seatCount
    }
  }

  await patchTeamBillingFromWebhookEventIfFresh({
    teamId,
    event,
    source: "webhook.subscription",
    billingPatch: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripeScheduleId: normalizeScheduleId(subscription.schedule),
      planKey: planInfo?.planKey ?? null,
      interval: planInfo?.interval ?? null,
      priceId,
      quantity,
      status: subscription.status,
      currentPeriodEnd: primaryItem?.current_period_end ?? null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
      isEntitled: isEntitledStatus(subscription.status),
    },
    context: { subscriptionId: subscription.id },
  })
}

async function applyInvoicePaidEvent(
  stripe: Stripe,
  event: StripeEventMeta,
  invoice: Stripe.Invoice
): Promise<void> {
  const teamId = await resolveTeamIdForInvoice(stripe, invoice)
  if (!teamId) {
    logger.warn("Unable to map invoice.paid webhook event to a team", {
      eventId: event.id,
      eventType: event.type,
      invoiceId: invoice.id,
    })
    return
  }

  const subscriptionId = getInvoiceSubscriptionId(invoice)
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : null

  let subscription: Stripe.Subscription | null = null
  if (subscriptionId) {
    try {
      subscription = await stripe.subscriptions.retrieve(subscriptionId)
    } catch (error) {
      logger.warn("Unable to retrieve subscription for invoice.paid event", {
        teamId,
        eventId: event.id,
        eventType: event.type,
        subscriptionId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const primaryItem =
    subscription?.items.data.length && subscription.items.data[0]
      ? getPrimarySubscriptionItem(subscription)
      : null
  const priceId = primaryItem?.price?.id ?? null
  let planInfo: { planKey: PlanKey; interval: BillingInterval } | null = null

  if (priceId) {
    try {
      planInfo = await mapPriceIdToPlan(stripe, priceId)
    } catch (error) {
      logger.warn("Unable to resolve Stripe lookup_key for invoice price", {
        eventId: event.id,
        eventType: event.type,
        teamId,
        priceId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const billingPatch: Record<string, unknown> = {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    lastInvoiceId: invoice.id,
    lastInvoiceStatus: invoice.status ?? "paid",
  }

  if (subscription) {
    billingPatch.stripeScheduleId = normalizeScheduleId(subscription.schedule)
    billingPatch.planKey = planInfo?.planKey ?? null
    billingPatch.interval = planInfo?.interval ?? null
    billingPatch.priceId = priceId
    billingPatch.quantity = getSubscriptionQuantity(subscription)
    billingPatch.status = subscription.status
    billingPatch.currentPeriodEnd = primaryItem?.current_period_end ?? null
    billingPatch.cancelAtPeriodEnd = subscription.cancel_at_period_end ?? false
    billingPatch.isEntitled = isEntitledStatus(subscription.status)
  } else {
    logger.warn(
      "Skipping entitlement update for invoice.paid without subscription context",
      {
        eventId: event.id,
        eventType: event.type,
        teamId,
        invoiceId: invoice.id,
        subscriptionId,
      }
    )
  }

  await patchTeamBillingFromWebhookEventIfFresh({
    teamId,
    event,
    source: "webhook.invoice.paid",
    billingPatch,
    context: { invoiceId: invoice.id },
  })
}

async function applyInvoicePaymentFailedEvent(
  stripe: Stripe,
  event: StripeEventMeta,
  invoice: Stripe.Invoice
): Promise<void> {
  const teamId = await resolveTeamIdForInvoice(stripe, invoice)
  if (!teamId) {
    logger.warn(
      "Unable to map invoice.payment_failed webhook event to a team",
      {
        eventId: event.id,
        eventType: event.type,
        invoiceId: invoice.id,
      }
    )
    return
  }

  const subscriptionId = getInvoiceSubscriptionId(invoice)
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : null

  await patchTeamBillingFromWebhookEventIfFresh({
    teamId,
    event,
    source: "webhook.invoice.payment_failed",
    billingPatch: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      status: "past_due",
      lastInvoiceId: invoice.id,
      lastInvoiceStatus: invoice.status ?? "payment_failed",
      isEntitled: false,
    },
    context: { invoiceId: invoice.id },
  })
}

async function applyInvoiceFinalizedEvent(
  stripe: Stripe,
  event: StripeEventMeta,
  invoice: Stripe.Invoice
): Promise<void> {
  const teamId = await resolveTeamIdForInvoice(stripe, invoice)
  if (!teamId) {
    logger.warn("Unable to map invoice.finalized webhook event to a team", {
      eventId: event.id,
      eventType: event.type,
      invoiceId: invoice.id,
    })
    return
  }

  const subscriptionId = getInvoiceSubscriptionId(invoice)
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : null

  await patchTeamBillingFromWebhookEventIfFresh({
    teamId,
    event,
    source: "webhook.invoice.finalized",
    billingPatch: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      lastInvoiceId: invoice.id,
      lastInvoiceStatus: invoice.status ?? "finalized",
    },
    context: { invoiceId: invoice.id },
  })
}

async function applyCheckoutSessionCompletedEvent(
  stripe: Stripe,
  event: StripeEventMeta,
  session: Stripe.Checkout.Session
): Promise<void> {
  const teamIdFromMetadata = getCheckoutSessionTeamId(session)
  const customerId =
    typeof session.customer === "string" ? session.customer : null
  const teamId =
    teamIdFromMetadata ??
    (customerId
      ? await findTeamIdByBillingField("billing.stripeCustomerId", customerId)
      : null)

  if (!teamId) {
    logger.warn("Unable to map checkout.session.completed webhook event", {
      eventId: event.id,
      eventType: event.type,
      checkoutSessionId: session.id,
    })
    return
  }

  const subscriptionId = getCheckoutSessionSubscriptionId(session)
  if (subscriptionId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId)
      await applySubscriptionEvent(stripe, event, subscription)
      return
    } catch (error) {
      logger.warn(
        "Unable to retrieve subscription for checkout.session.completed",
        {
          teamId,
          eventId: event.id,
          eventType: event.type,
          checkoutSessionId: session.id,
          subscriptionId,
          message: error instanceof Error ? error.message : String(error),
        }
      )
    }
  }

  const seatCount = Number.parseInt(session.metadata?.seatCount ?? "", 10)
  const billingPatch: Record<string, unknown> = {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
  }
  if (Number.isFinite(seatCount) && seatCount > 0) {
    billingPatch.quantity = Math.floor(seatCount)
  }

  await patchTeamBillingFromWebhookEventIfFresh({
    teamId,
    event,
    source: "webhook.checkout.session.completed",
    billingPatch,
    context: { checkoutSessionId: session.id, subscriptionId },
  })
}

function normalizeBillingStatusPayload(
  billingData: TeamBillingData | undefined
): TeamBillingData {
  return {
    stripeCustomerId: billingData?.stripeCustomerId ?? null,
    stripeSubscriptionId: billingData?.stripeSubscriptionId ?? null,
    stripeScheduleId: billingData?.stripeScheduleId ?? null,
    planKey: billingData?.planKey ?? null,
    interval: billingData?.interval ?? null,
    priceId: billingData?.priceId ?? null,
    quantity: normalizeQuantity(billingData?.quantity) ?? null,
    status: billingData?.status ?? null,
    currentPeriodEnd: billingData?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: billingData?.cancelAtPeriodEnd ?? false,
    lastInvoiceId: billingData?.lastInvoiceId ?? null,
    lastInvoiceStatus: billingData?.lastInvoiceStatus ?? null,
    lastStripeEventId: billingData?.lastStripeEventId ?? null,
    lastStripeEventCreated:
      normalizeEventCreatedSeconds(billingData?.lastStripeEventCreated) ?? null,
    isEntitled: billingData?.isEntitled ?? false,
  }
}

export const createCheckoutSession = onCall(
  {
    ...CALLABLE_OPTS,
    secrets: [stripeSecretKey],
  },
  async (request) => {
    const data = getObject(request.data)
    const teamId = assertString(data, "teamId")
    const planKey = assertPlanKey(data, "planKey")
    const interval = assertBillingInterval(data, "interval")
    const returnUrl = buildBillingReturnUrl()

    const context = await getTeamBillingContext(request, teamId, {
      requireBillingPermission: true,
    })
    const stripe = getStripeClient()
    const customerId = await ensureStripeCustomer(
      stripe,
      context,
      request.auth?.token.email ?? null
    )

    const existingSubscriptionRef = await resolveTeamSubscription(
      stripe,
      context,
      customerId
    )

    if (
      existingSubscriptionRef &&
      activeLikeStatuses.has(existingSubscriptionRef.subscription.status)
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Team already has an active Stripe subscription."
      )
    }

    let selectedPriceId: string
    try {
      selectedPriceId = await getPriceId(stripe, planKey, interval)
    } catch (error) {
      throw new HttpsError(
        "failed-precondition",
        error instanceof Error
          ? error.message
          : "Unable to resolve Stripe price for selected plan."
      )
    }
    const seatCount = await countBillableSeats(teamId)
    const idempotencyKey = buildStripeIdempotencyKey(
      "checkout.create",
      context.uid,
      teamId,
      {
        planKey,
        interval,
        seatCount,
      }
    )

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        success_url: returnUrl,
        cancel_url: returnUrl,
        line_items: [{ price: selectedPriceId, quantity: seatCount }],
        metadata: {
          uid: context.uid,
          teamId,
          planKey,
          interval,
          seatCount: String(seatCount),
          environment: getEnvironmentLabel(),
        },
        subscription_data: {
          metadata: {
            uid: context.uid,
            teamId,
            planKey,
            interval,
            seatCount: String(seatCount),
            environment: getEnvironmentLabel(),
          },
        },
      },
      { idempotencyKey }
    )

    if (!session.url) {
      throw new HttpsError(
        "internal",
        "Stripe checkout session did not return a redirect URL."
      )
    }

    await context.teamRef.set(
      {
        billing: {
          quantity: seatCount,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    )

    return { url: session.url }
  }
)

export const createBillingPortalSession = onCall(
  {
    ...CALLABLE_OPTS,
    secrets: [stripeSecretKey],
  },
  async (request) => {
    const data = getObject(request.data)
    const teamId = assertString(data, "teamId")
    const returnUrl = buildBillingReturnUrl()

    const context = await getTeamBillingContext(request, teamId, {
      requireBillingPermission: true,
    })
    const stripe = getStripeClient()
    const customerId = await ensureStripeCustomer(
      stripe,
      context,
      request.auth?.token.email ?? null
    )

    const subscriptionRef = await resolveTeamSubscription(
      stripe,
      context,
      customerId
    )

    if (
      !subscriptionRef ||
      !activeLikeStatuses.has(subscriptionRef.subscription.status)
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Team does not have an active Stripe subscription."
      )
    }

    const portalSession = await stripe.billingPortal.sessions.create(
      {
        customer: customerId,
        return_url: returnUrl,
      },
      {
        idempotencyKey: buildStripeIdempotencyKey(
          "portal.create",
          context.uid,
          teamId,
          {}
        ),
      }
    )

    return { url: portalSession.url }
  }
)

export const changeSubscriptionPlan = onCall(
  {
    ...CALLABLE_OPTS,
    secrets: [stripeSecretKey],
  },
  async (request) => {
    const data = getObject(request.data)
    const teamId = assertString(data, "teamId")
    const targetPlanKey = assertPlanKey(data, "targetPlanKey")
    const targetInterval = assertBillingInterval(data, "targetInterval")
    const explicitTiming = assertPlanTiming(data, "timing")

    const context = await getTeamBillingContext(request, teamId, {
      requireBillingPermission: true,
    })
    const stripe = getStripeClient()
    const customerId = await ensureStripeCustomer(
      stripe,
      context,
      request.auth?.token.email ?? null
    )

    const subscriptionRef = await resolveTeamSubscription(
      stripe,
      context,
      customerId
    )

    if (
      !subscriptionRef ||
      !activeLikeStatuses.has(subscriptionRef.subscription.status)
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Team does not have an active Stripe subscription."
      )
    }

    const { subscription } = subscriptionRef
    const primaryItem = getPrimarySubscriptionItem(subscription)
    const currentPriceId = primaryItem.price.id
    const seatCount = await countBillableSeats(teamId)
    let currentPlan: { planKey: PlanKey; interval: BillingInterval } | null
    try {
      currentPlan = await mapPriceIdToPlan(stripe, currentPriceId)
    } catch (error) {
      throw new HttpsError(
        "internal",
        error instanceof Error
          ? error.message
          : "Unable to resolve current Stripe price."
      )
    }

    if (!currentPlan) {
      throw new HttpsError(
        "failed-precondition",
        "Current Stripe price does not have a valid lookup_key mapping."
      )
    }

    let targetPriceId: string
    try {
      targetPriceId = await getPriceId(stripe, targetPlanKey, targetInterval)
    } catch (error) {
      throw new HttpsError(
        "failed-precondition",
        error instanceof Error
          ? error.message
          : "Unable to resolve Stripe price for target plan."
      )
    }
    if (currentPriceId === targetPriceId) {
      return summarizeSubscription(subscription)
    }

    const timing = resolvePlanChangeTiming(
      explicitTiming,
      currentPlan.planKey,
      targetPlanKey
    )

    if (timing === "immediate") {
      await releaseSubscriptionSchedule(
        stripe,
        subscription,
        buildStripeIdempotencyKey(
          "subscription.schedule.release",
          context.uid,
          teamId,
          {
            subscriptionId: subscription.id,
          }
        )
      ).catch((error) => {
        logger.warn(
          "Unable to release existing schedule before immediate change",
          {
            teamId,
            subscriptionId: subscription.id,
            message: error instanceof Error ? error.message : String(error),
          }
        )
      })

      const updated = await stripe.subscriptions.update(
        subscription.id,
        {
          cancel_at_period_end: false,
          proration_behavior: "create_prorations",
          items: [
            { id: primaryItem.id, price: targetPriceId, quantity: seatCount },
          ],
        },
        {
          idempotencyKey: buildStripeIdempotencyKey(
            "subscription.plan.change.immediate",
            context.uid,
            teamId,
            {
              subscriptionId: subscription.id,
              targetPriceId,
            }
          ),
        }
      )
      const summary = summarizeSubscription(updated, targetPriceId)
      await context.teamRef.set(
        {
          billing: {
            stripeCustomerId: customerId,
            stripeSubscriptionId: updated.id,
            stripeScheduleId: normalizeScheduleId(updated.schedule),
            planKey: targetPlanKey,
            interval: targetInterval,
            priceId: summary.priceId,
            quantity: summary.quantity,
            status: summary.status,
            currentPeriodEnd: summary.currentPeriodEnd,
            cancelAtPeriodEnd: summary.cancelAtPeriodEnd,
            isEntitled: isEntitledStatus(summary.status),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        { merge: true }
      )
      return summary
    }

    const scheduleId = await schedulePlanChangeAtPeriodEnd({
      stripe,
      teamId,
      uid: context.uid,
      subscription,
      quantity: seatCount,
      targetPriceId,
      targetPlanKey,
      targetInterval,
    })

    const summary = summarizeSubscription(subscription)
    await context.teamRef.set(
      {
        billing: {
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscription.id,
          stripeScheduleId: scheduleId,
          planKey: currentPlan.planKey,
          interval: currentPlan.interval,
          priceId: summary.priceId,
          quantity: summary.quantity,
          status: summary.status,
          currentPeriodEnd: summary.currentPeriodEnd,
          cancelAtPeriodEnd: summary.cancelAtPeriodEnd,
          isEntitled: isEntitledStatus(summary.status),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    )

    return summary
  }
)

export const cancelSubscription = onCall(
  {
    ...CALLABLE_OPTS,
    secrets: [stripeSecretKey],
  },
  async (request) => {
    const data = getObject(request.data)
    const teamId = assertString(data, "teamId")
    const when = getString(data, "when")
    if (when && when !== "period_end") {
      throw new HttpsError(
        "invalid-argument",
        `when must be "period_end" when provided.`
      )
    }

    const context = await getTeamBillingContext(request, teamId, {
      requireBillingPermission: true,
    })
    const stripe = getStripeClient()
    const customerId = await ensureStripeCustomer(
      stripe,
      context,
      request.auth?.token.email ?? null
    )

    const subscriptionRef = await resolveTeamSubscription(
      stripe,
      context,
      customerId
    )

    if (
      !subscriptionRef ||
      !activeLikeStatuses.has(subscriptionRef.subscription.status)
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Team does not have an active Stripe subscription."
      )
    }

    const { subscription } = subscriptionRef
    await releaseSubscriptionSchedule(
      stripe,
      subscription,
      buildStripeIdempotencyKey(
        "subscription.schedule.release",
        context.uid,
        teamId,
        {
          subscriptionId: subscription.id,
        }
      )
    ).catch((error) => {
      logger.warn("Unable to release existing schedule before cancellation", {
        teamId,
        subscriptionId: subscription.id,
        message: error instanceof Error ? error.message : String(error),
      })
    })

    const updated = await stripe.subscriptions.update(
      subscription.id,
      {
        cancel_at_period_end: true,
      },
      {
        idempotencyKey: buildStripeIdempotencyKey(
          "subscription.cancel.period_end",
          context.uid,
          teamId,
          {
            subscriptionId: subscription.id,
          }
        ),
      }
    )

    const summary = summarizeSubscription(updated)
    const existingBilling = getTeamBillingData(context.teamData)
    await context.teamRef.set(
      {
        billing: {
          stripeCustomerId: customerId,
          stripeSubscriptionId: updated.id,
          stripeScheduleId: normalizeScheduleId(updated.schedule),
          planKey: existingBilling.planKey ?? null,
          interval: existingBilling.interval ?? null,
          priceId: summary.priceId,
          quantity: summary.quantity,
          status: summary.status,
          currentPeriodEnd: summary.currentPeriodEnd,
          cancelAtPeriodEnd: summary.cancelAtPeriodEnd,
          isEntitled: isEntitledStatus(summary.status),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    )

    return summary
  }
)

export const restoreSubscription = onCall(
  {
    ...CALLABLE_OPTS,
    secrets: [stripeSecretKey],
  },
  async (request) => {
    const data = getObject(request.data)
    const teamId = assertString(data, "teamId")

    const context = await getTeamBillingContext(request, teamId, {
      requireBillingPermission: true,
    })
    const stripe = getStripeClient()
    const customerId = await ensureStripeCustomer(
      stripe,
      context,
      request.auth?.token.email ?? null
    )

    const subscriptionRef = await resolveTeamSubscription(
      stripe,
      context,
      customerId
    )

    if (
      !subscriptionRef ||
      !activeLikeStatuses.has(subscriptionRef.subscription.status)
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Team does not have an active Stripe subscription to restore."
      )
    }

    const { subscription } = subscriptionRef
    if (!subscription.cancel_at_period_end) {
      return summarizeSubscription(subscription)
    }

    const updated = await stripe.subscriptions.update(
      subscription.id,
      {
        cancel_at_period_end: false,
      },
      {
        idempotencyKey: buildStripeIdempotencyKey(
          "subscription.restore",
          context.uid,
          teamId,
          {
            subscriptionId: subscription.id,
          }
        ),
      }
    )

    const summary = summarizeSubscription(updated)
    const existingBilling = getTeamBillingData(context.teamData)
    await context.teamRef.set(
      {
        billing: {
          stripeCustomerId: customerId,
          stripeSubscriptionId: updated.id,
          stripeScheduleId: normalizeScheduleId(updated.schedule),
          planKey: existingBilling.planKey ?? null,
          interval: existingBilling.interval ?? null,
          priceId: summary.priceId,
          quantity: summary.quantity,
          status: summary.status,
          currentPeriodEnd: summary.currentPeriodEnd,
          cancelAtPeriodEnd: summary.cancelAtPeriodEnd,
          isEntitled: isEntitledStatus(summary.status),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    )

    return summary
  }
)

export const getBillingStatus = onCall(CALLABLE_OPTS, async (request) => {
  const data = getObject(request.data)
  const teamId = assertString(data, "teamId")
  const context = await getTeamBillingContext(request, teamId, {
    requireBillingPermission: false,
  })

  const billing = normalizeBillingStatusPayload(
    getTeamBillingData(context.teamData)
  )
  return { billing }
})

/**
 * HTTP endpoint for the billing catalog.
 * Returns callable-compatible JSON so `httpsCallable` can consume it.
 *
 * Cache-Control headers are set on success: the catalog is identical
 * for every caller and changes only when admins edit Stripe pricing,
 * so a short browser cache + longer CDN cache is safe. The headers
 * are mostly no-ops today (callable POSTs aren't browser-cached), but
 * they pay off the moment this endpoint is routed via Firebase
 * Hosting rewrites — the CDN edge will then absorb repeat hits.
 *
 * `stale-while-revalidate` covers the case where the cache has
 * expired but a fresh fetch is in flight — serve stale instead of
 * making the user wait on a Stripe round-trip.
 *
 * Error responses are explicitly marked `no-store` so a transient
 * 412 doesn't get cached and poison subsequent loads.
 */
export const getBillingCatalogHttp = onRequest(
  {
    ...CALLABLE_OPTS,
    invoker: "public",
    cors: true,
    secrets: [stripeSecretKey],
  },
  async (_request, response) => {
    const stripe = getStripeClient()

    try {
      const prices = await resolveBillingCatalogFromStripe(stripe)
      response.set(
        "Cache-Control",
        "public, max-age=60, s-maxage=300, stale-while-revalidate=3600"
      )
      response.set("Vary", "Origin")
      response.status(200).json({ data: { prices } })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to resolve Stripe billing catalog."
      response.set("Cache-Control", "no-store")
      response.status(412).json({
        error: {
          status: "FAILED_PRECONDITION",
          message,
        },
      })
    }
  }
)

type BillingReconcileState = {
  lastSubscriptionId?: string | null
  lastTeamId?: string | null
}

async function reconcileSeatQuantitiesBatch(
  stripe: Stripe
): Promise<{ processed: number; updated: number; failed: number }> {
  const stateRef = db.doc(BILLING_RECONCILE_STATE_DOC)
  const stateSnap = await stateRef.get()
  const state = (stateSnap.data() ?? {}) as BillingReconcileState
  const lastSubscriptionId =
    typeof state.lastSubscriptionId === "string" &&
    state.lastSubscriptionId.trim().length > 0
      ? state.lastSubscriptionId
      : null
  const lastTeamId =
    typeof state.lastTeamId === "string" && state.lastTeamId.trim().length > 0
      ? state.lastTeamId
      : null

  let query = db
    .collection("teams")
    .where("billing.stripeSubscriptionId", "!=", null)
    .orderBy("billing.stripeSubscriptionId")
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(BILLING_RECONCILE_BATCH_SIZE)

  if (lastSubscriptionId && lastTeamId) {
    query = query.startAfter(lastSubscriptionId, lastTeamId)
  }

  const teamsSnap = await query.get()
  if (teamsSnap.empty) {
    await stateRef.set(
      {
        lastSubscriptionId: null,
        lastTeamId: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    return { processed: 0, updated: 0, failed: 0 }
  }

  let processed = 0
  let updated = 0
  let failed = 0

  for (const teamDoc of teamsSnap.docs) {
    try {
      const result = await syncSubscriptionQuantityToSeats({
        stripe,
        teamId: teamDoc.id,
        source: "scheduler.reconcile",
        teamData: teamDoc.data() as Record<string, unknown>,
      })
      processed += 1
      if (result.updated) updated += 1
    } catch (error) {
      failed += 1
      logger.error("[billing.quantity.sync] Reconcile failed for team", {
        teamId: teamDoc.id,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const hasMore = teamsSnap.size === BILLING_RECONCILE_BATCH_SIZE
  const lastDoc = teamsSnap.docs[teamsSnap.docs.length - 1]
  const lastDocBilling = getTeamBillingData(
    lastDoc.data() as Record<string, unknown>
  )

  await stateRef.set(
    {
      lastSubscriptionId: hasMore
        ? (lastDocBilling.stripeSubscriptionId ?? null)
        : null,
      lastTeamId: hasMore ? lastDoc.id : null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  )

  return { processed, updated, failed }
}

export const syncBillingQuantityOnMembershipCreated = onDocumentCreated(
  {
    document: "teams/{teamId}/memberships/{userId}",
    secrets: [stripeSecretKey],
    ...TRIGGER_OPTS,
  },
  async (event) => {
    const { teamId } = event.params
    const stripe = getStripeClient()
    await syncSubscriptionQuantityToSeats({
      stripe,
      teamId,
      source: "membership.created",
    })
  }
)

export const syncBillingQuantityOnMembershipDeleted = onDocumentDeleted(
  {
    document: "teams/{teamId}/memberships/{userId}",
    secrets: [stripeSecretKey],
    ...TRIGGER_OPTS,
  },
  async (event) => {
    const { teamId } = event.params
    const stripe = getStripeClient()
    await syncSubscriptionQuantityToSeats({
      stripe,
      teamId,
      source: "membership.deleted",
    })
  }
)

export const syncBillingQuantityOnMembershipUpdated = onDocumentUpdated(
  {
    document: "teams/{teamId}/memberships/{userId}",
    secrets: [stripeSecretKey],
    ...TRIGGER_OPTS,
  },
  async (event) => {
    if (!event.data) return
    const beforeRole = normalizeMembershipRole(event.data.before.data()?.role)
    const afterRole = normalizeMembershipRole(event.data.after.data()?.role)
    if (!hasBillableRoleTransition(beforeRole, afterRole)) {
      return
    }

    const { teamId } = event.params
    const stripe = getStripeClient()
    await syncSubscriptionQuantityToSeats({
      stripe,
      teamId,
      source: "membership.role.transition",
    })
  }
)

export const reconcileBillingSeatQuantities = onSchedule(
  {
    schedule: "every 1 hours",
    timeZone: "UTC",
    retryCount: 1,
    secrets: [stripeSecretKey],
    ...SCHEDULED_OPTS,
  },
  async () => {
    const stripe = getStripeClient()
    const summary = await reconcileSeatQuantitiesBatch(stripe)
    logger.info("[billing.quantity.sync] Reconcile batch completed", summary)
  }
)

export const cleanupStripeWebhookEventLocks = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "UTC",
    retryCount: 1,
    ...SCHEDULED_OPTS,
  },
  async () => {
    const deleted = await cleanupExpiredStripeWebhookLocks({ batchSize: 450 })
    logger.info("[billing] Cleaned expired Stripe webhook event locks", {
      deleted,
    })
  }
)

export const stripeWebhook = onRequest(
  {
    ...CALLABLE_OPTS,
    invoker: "public",
    cors: false,
    secrets: [stripeSecretKey, stripeWebhookSecret],
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).send("Method Not Allowed")
      return
    }

    const signatureHeader = request.headers["stripe-signature"]
    const signature =
      typeof signatureHeader === "string" ? signatureHeader : undefined
    if (!signature) {
      response.status(400).send("Missing Stripe signature.")
      return
    }

    const rawBody = request.rawBody
    if (!rawBody) {
      response.status(400).send("Missing raw request body.")
      return
    }

    const webhookSecret = stripeWebhookSecret.value()
    if (!webhookSecret) {
      response.status(500).send("Webhook secret not configured.")
      return
    }

    const stripe = getStripeClient()

    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
    } catch (error) {
      logger.error("Stripe webhook signature verification failed", {
        message: error instanceof Error ? error.message : String(error),
      })
      response.status(400).send("Invalid Stripe webhook signature.")
      return
    }

    const shouldProcess = await markWebhookEventProcessing(event.id)
    if (!shouldProcess) {
      response.status(200).json({ received: true, duplicate: true })
      return
    }

    try {
      const eventMeta: StripeEventMeta = {
        id: event.id,
        created: event.created,
        type: event.type,
      }

      switch (event.type) {
        case "checkout.session.completed": {
          const checkoutSession = event.data.object as Stripe.Checkout.Session
          await applyCheckoutSessionCompletedEvent(
            stripe,
            eventMeta,
            checkoutSession
          )
          break
        }
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          const subscription = event.data.object as Stripe.Subscription
          await applySubscriptionEvent(stripe, eventMeta, subscription)
          break
        }
        case "invoice.finalized": {
          const invoice = event.data.object as Stripe.Invoice
          await applyInvoiceFinalizedEvent(stripe, eventMeta, invoice)
          break
        }
        case "invoice.paid": {
          const invoice = event.data.object as Stripe.Invoice
          await applyInvoicePaidEvent(stripe, eventMeta, invoice)
          break
        }
        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice
          await applyInvoicePaymentFailedEvent(stripe, eventMeta, invoice)
          break
        }
        default:
          logger.info("Ignored Stripe webhook event", { type: event.type })
      }

      await completeWebhookEventProcessing(event.id, "done", null)
      response.status(200).json({ received: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await completeWebhookEventProcessing(event.id, "error", message)
      logger.error("Stripe webhook processing failed", {
        eventId: event.id,
        type: event.type,
        message,
      })
      response.status(500).send("Stripe webhook processing failed.")
    }
  }
)
