import * as logger from "firebase-functions/logger"
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
  getPriceId,
  mapPriceIdToPlan,
  resolveBillingCatalogFromStripe,
} from "./billingConfig.js"
import { admin, db } from "./firebase.js"
import { makeEventIdempotencyKey } from "./idempotency.js"
import { can } from "./permissions.js"
import { CALLABLE_OPTS, SCHEDULED_OPTS } from "./runtimeConfig.js"
import { stripeSecretKey, stripeWebhookSecret } from "./secrets.js"
import { Capabilities, IMembershipRole } from "./types.js"

type PlanChangeTiming = "immediate" | "period_end"

type TeamBillingData = {
  stripeCustomerId?: string | null
  stripeSubscriptionId?: string | null
  stripeScheduleId?: string | null
  planKey?: PlanKey | null
  interval?: BillingInterval | null
  priceId?: string | null
  status?: string | null
  currentPeriodEnd?: number | null
  cancelAtPeriodEnd?: boolean
  lastInvoiceId?: string | null
  lastInvoiceStatus?: string | null
  lastStripeEventId?: string | null
  isEntitled?: boolean
}

interface BillingSummary {
  status: string | null
  currentPeriodEnd: number | null
  cancelAtPeriodEnd: boolean
  priceId: string | null
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
const BILLING_RETURN_PATH = "/settings#billing"

const PLAN_KEYS: PlanKey[] = [
  "personal",
  "professional",
  "business",
  "enterprise",
]
const BILLING_INTERVALS: BillingInterval[] = ["month", "year"]

const activeLikeStatuses = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
])
const entitledStatuses = new Set(["active", "trialing", "past_due", "unpaid"])

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
  return `${getBillingAppOrigin()}${BILLING_RETURN_PATH}`
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

function summarizeSubscription(
  subscription: Stripe.Subscription,
  overridePriceId?: string | null
): BillingSummary {
  const item = subscription.items.data[0]
  const itemPriceId = item?.price?.id ?? null

  return {
    status: subscription.status,
    currentPeriodEnd: item?.current_period_end ?? null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    priceId: overridePriceId ?? itemPriceId,
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

function toSubscriptionCandidate(
  subscriptions: Stripe.Subscription[]
): Stripe.Subscription | null {
  const candidates = subscriptions
    .filter(
      (subscription) =>
        !["canceled", "incomplete_expired"].includes(subscription.status)
    )
    .sort((left, right) => right.created - left.created)
  return candidates[0] ?? null
}

async function resolveTeamSubscription(
  stripe: Stripe,
  context: TeamBillingContext,
  customerId: string
): Promise<StripeSubscriptionReference | null> {
  const billing = getTeamBillingData(context.teamData)
  const preferredSubscriptionId = billing.stripeSubscriptionId

  if (preferredSubscriptionId) {
    try {
      const preferred = await stripe.subscriptions.retrieve(
        preferredSubscriptionId
      )
      if (!["canceled", "incomplete_expired"].includes(preferred.status)) {
        return { subscription: preferred, customerId }
      }
    } catch (error) {
      logger.warn("Unable to retrieve preferred Stripe subscription", {
        teamId: context.teamId,
        subscriptionId: preferredSubscriptionId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const listed = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 20,
  })

  const candidate = toSubscriptionCandidate(listed.data)
  return candidate ? { subscription: candidate, customerId } : null
}

function resolvePlanChangeTiming(
  explicitTiming: PlanChangeTiming | null
): PlanChangeTiming {
  return explicitTiming ?? "immediate"
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
  targetPriceId: string
  targetPlanKey: PlanKey
  targetInterval: BillingInterval
}): Promise<string> {
  const {
    stripe,
    teamId,
    uid,
    subscription,
    targetPriceId,
    targetPlanKey,
    targetInterval,
  } = args

  const primaryItem = getPrimarySubscriptionItem(subscription)
  const currentPriceId = primaryItem.price.id
  const quantity = primaryItem.quantity ?? 1

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

async function applySubscriptionEvent(
  stripe: Stripe,
  eventId: string,
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
      eventId,
      subscriptionId: subscription.id,
    })
    return
  }

  const primaryItem =
    subscription.items.data.length > 0
      ? getPrimarySubscriptionItem(subscription)
      : null
  const priceId = primaryItem?.price?.id ?? null
  let planInfo: { planKey: PlanKey; interval: BillingInterval } | null = null

  if (priceId) {
    try {
      planInfo = await mapPriceIdToPlan(stripe, priceId)
    } catch (error) {
      logger.warn(
        "Unable to resolve Stripe lookup_key for subscription price",
        {
          eventId,
          teamId,
          priceId,
          message: error instanceof Error ? error.message : String(error),
        }
      )
    }
  }

  await db.doc(`teams/${teamId}`).set(
    {
      billing: {
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscription.id,
        stripeScheduleId: normalizeScheduleId(subscription.schedule),
        planKey: planInfo?.planKey ?? null,
        interval: planInfo?.interval ?? null,
        priceId,
        status: subscription.status,
        currentPeriodEnd: primaryItem?.current_period_end ?? null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
        lastStripeEventId: eventId,
        isEntitled: isEntitledStatus(subscription.status),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  )
}

async function applyInvoicePaidEvent(
  stripe: Stripe,
  eventId: string,
  invoice: Stripe.Invoice
): Promise<void> {
  const teamId = await resolveTeamIdForInvoice(stripe, invoice)
  if (!teamId) {
    logger.warn("Unable to map invoice.paid webhook event to a team", {
      eventId,
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
        eventId,
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
    lastStripeEventId: eventId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }

  if (subscription) {
    billingPatch.stripeScheduleId = normalizeScheduleId(subscription.schedule)
    billingPatch.planKey = planInfo?.planKey ?? null
    billingPatch.interval = planInfo?.interval ?? null
    billingPatch.priceId = priceId
    billingPatch.status = subscription.status
    billingPatch.currentPeriodEnd = primaryItem?.current_period_end ?? null
    billingPatch.cancelAtPeriodEnd = subscription.cancel_at_period_end ?? false
    billingPatch.isEntitled = isEntitledStatus(subscription.status)
  } else {
    logger.warn(
      "Skipping entitlement update for invoice.paid without subscription context",
      {
        eventId,
        teamId,
        invoiceId: invoice.id,
        subscriptionId,
      }
    )
  }

  await db.doc(`teams/${teamId}`).set(
    {
      billing: billingPatch,
    },
    { merge: true }
  )
}

async function applyInvoicePaymentFailedEvent(
  stripe: Stripe,
  eventId: string,
  invoice: Stripe.Invoice
): Promise<void> {
  const teamId = await resolveTeamIdForInvoice(stripe, invoice)
  if (!teamId) {
    logger.warn(
      "Unable to map invoice.payment_failed webhook event to a team",
      {
        eventId,
        invoiceId: invoice.id,
      }
    )
    return
  }

  const subscriptionId = getInvoiceSubscriptionId(invoice)
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : null

  await db.doc(`teams/${teamId}`).set(
    {
      billing: {
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        status: "past_due",
        lastInvoiceId: invoice.id,
        lastInvoiceStatus: invoice.status ?? "payment_failed",
        lastStripeEventId: eventId,
        isEntitled: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  )
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
    status: billingData?.status ?? null,
    currentPeriodEnd: billingData?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: billingData?.cancelAtPeriodEnd ?? false,
    lastInvoiceId: billingData?.lastInvoiceId ?? null,
    lastInvoiceStatus: billingData?.lastInvoiceStatus ?? null,
    lastStripeEventId: billingData?.lastStripeEventId ?? null,
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
    const idempotencyKey = buildStripeIdempotencyKey(
      "checkout.create",
      context.uid,
      teamId,
      {
        planKey,
        interval,
      }
    )

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        success_url: returnUrl,
        cancel_url: returnUrl,
        line_items: [{ price: selectedPriceId, quantity: 1 }],
        metadata: {
          uid: context.uid,
          teamId,
          planKey,
          interval,
          environment: getEnvironmentLabel(),
        },
        subscription_data: {
          metadata: {
            uid: context.uid,
            teamId,
            planKey,
            interval,
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

    const timing = resolvePlanChangeTiming(explicitTiming)

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
          items: [{ id: primaryItem.id, price: targetPriceId }],
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

export const getBillingCatalog = onCall(
  {
    ...CALLABLE_OPTS,
    invoker: "public",
    secrets: [stripeSecretKey],
  },
  async () => {
    const stripe = getStripeClient()

    try {
      const prices = await resolveBillingCatalogFromStripe(stripe)
      return { prices }
    } catch (error) {
      throw new HttpsError(
        "failed-precondition",
        error instanceof Error
          ? error.message
          : "Unable to resolve Stripe billing catalog."
      )
    }
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
      switch (event.type) {
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          const subscription = event.data.object as Stripe.Subscription
          await applySubscriptionEvent(stripe, event.id, subscription)
          break
        }
        case "invoice.paid": {
          const invoice = event.data.object as Stripe.Invoice
          await applyInvoicePaidEvent(stripe, event.id, invoice)
          break
        }
        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice
          await applyInvoicePaymentFailedEvent(stripe, event.id, invoice)
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
