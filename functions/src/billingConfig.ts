import Stripe from "stripe"

import {
  BILLING_INTERVALS,
  BILLING_PLAN_KEYS,
  PLAN_TOKEN_ALLOWANCES,
} from "./domain.js"

const PLAN_ORDER = BILLING_PLAN_KEYS

const PRICE_CACHE_TTL_MS = 10 * 60 * 1000

export type PlanKey = (typeof PLAN_ORDER)[number]
export type BillingInterval = (typeof BILLING_INTERVALS)[number]

export interface BillingCatalogPrice {
  priceId: string
  unitAmount: number | null
  currency: string | null
}

export type BillingCatalog = Record<
  PlanKey,
  Record<BillingInterval, BillingCatalogPrice>
>

export interface ReversePriceMapEntry {
  planKey: PlanKey
  interval: BillingInterval
}

const planKeySet = new Set<string>(PLAN_ORDER)
const intervalSet = new Set<string>(BILLING_INTERVALS)
const allLookupKeys = PLAN_ORDER.flatMap((planKey) =>
  BILLING_INTERVALS.map((interval) => getPriceLookupKey(planKey, interval))
)

const priceIdCacheByLookupKey = new Map<
  string,
  { priceId: string; cachedAtMs: number }
>()
const priceCatalogCacheByLookupKey = new Map<
  string,
  { price: BillingCatalogPrice; cachedAtMs: number }
>()
const planInfoCacheByPriceId = new Map<
  string,
  { planInfo: ReversePriceMapEntry | null; cachedAtMs: number }
>()

function isCacheEntryFresh(cachedAtMs: number): boolean {
  return Date.now() - cachedAtMs < PRICE_CACHE_TTL_MS
}

export function getPriceLookupKey(
  planKey: PlanKey,
  interval: BillingInterval
): string {
  return `${planKey}_${interval}`
}

function parseLookupKey(
  lookupKey: string | null | undefined
): ReversePriceMapEntry | null {
  if (!lookupKey) return null

  const normalizedLookupKey = lookupKey.trim().toLowerCase()
  if (!normalizedLookupKey) return null

  const [rawPlanKey, rawInterval, ...rest] = normalizedLookupKey.split("_")
  if (rest.length > 0) return null

  if (!planKeySet.has(rawPlanKey) || !intervalSet.has(rawInterval)) {
    return null
  }

  return {
    planKey: rawPlanKey as PlanKey,
    interval: rawInterval as BillingInterval,
  }
}

function isRecurringPriceWithInterval(
  price: Stripe.Price,
  interval: BillingInterval
): boolean {
  return price.type === "recurring" && price.recurring?.interval === interval
}

function isLookupKeyCacheFresh(lookupKey: string): boolean {
  const cachedPriceId = priceIdCacheByLookupKey.get(lookupKey)
  const cachedCatalog = priceCatalogCacheByLookupKey.get(lookupKey)
  return (
    !!cachedPriceId &&
    !!cachedCatalog &&
    isCacheEntryFresh(cachedPriceId.cachedAtMs) &&
    isCacheEntryFresh(cachedCatalog.cachedAtMs)
  )
}

function isCatalogCacheFresh(): boolean {
  return allLookupKeys.every((lookupKey) => isLookupKeyCacheFresh(lookupKey))
}

function cacheCatalogPrice(
  lookupKey: string,
  planInfo: ReversePriceMapEntry,
  price: Stripe.Price
): void {
  const nowMs = Date.now()
  const priceSnapshot: BillingCatalogPrice = {
    priceId: price.id,
    unitAmount: price.unit_amount ?? null,
    currency: price.currency ?? null,
  }

  priceIdCacheByLookupKey.set(lookupKey, {
    priceId: price.id,
    cachedAtMs: nowMs,
  })
  priceCatalogCacheByLookupKey.set(lookupKey, {
    price: priceSnapshot,
    cachedAtMs: nowMs,
  })
  planInfoCacheByPriceId.set(price.id, {
    planInfo,
    cachedAtMs: nowMs,
  })
}

// Singleflight handle — when the cache is stale and N concurrent
// requests miss simultaneously, they share one underlying Stripe
// `prices.list` call instead of each spawning their own. Cleared in
// `.finally()` so a failed refresh doesn't permanently latch other
// callers onto the rejection.
let refreshCatalogInflight: Promise<Map<string, BillingCatalogPrice>> | null =
  null

async function refreshCatalogCache(
  stripe: Stripe
): Promise<Map<string, BillingCatalogPrice>> {
  if (refreshCatalogInflight) return refreshCatalogInflight
  refreshCatalogInflight = refreshCatalogCacheUncached(stripe).finally(() => {
    refreshCatalogInflight = null
  })
  return refreshCatalogInflight
}

async function refreshCatalogCacheUncached(
  stripe: Stripe
): Promise<Map<string, BillingCatalogPrice>> {
  const listed = await stripe.prices.list({
    lookup_keys: allLookupKeys,
    active: true,
    limit: 100,
  })

  const candidatesByLookupKey = new Map<string, Stripe.Price[]>()
  for (const lookupKey of allLookupKeys) {
    candidatesByLookupKey.set(lookupKey, [])
  }

  for (const price of listed.data) {
    if (!price.active || !price.lookup_key) continue

    const planInfo = parseLookupKey(price.lookup_key)
    if (!planInfo) continue
    if (!isRecurringPriceWithInterval(price, planInfo.interval)) continue

    const candidates = candidatesByLookupKey.get(price.lookup_key)
    if (!candidates) continue
    candidates.push(price)
  }

  const resolved = new Map<string, BillingCatalogPrice>()

  for (const lookupKey of allLookupKeys) {
    const candidates = candidatesByLookupKey.get(lookupKey) ?? []

    if (candidates.length === 0) {
      throw new Error(
        `No active Stripe recurring price found for lookup_key "${lookupKey}".`
      )
    }

    if (candidates.length > 1) {
      throw new Error(
        `Multiple active Stripe prices found for lookup_key "${lookupKey}". Keep exactly one active price per lookup_key.`
      )
    }

    const selectedPrice = candidates[0]
    const planInfo = parseLookupKey(lookupKey)
    if (!planInfo) {
      throw new Error(`Invalid Stripe lookup_key "${lookupKey}".`)
    }

    cacheCatalogPrice(lookupKey, planInfo, selectedPrice)
    resolved.set(lookupKey, {
      priceId: selectedPrice.id,
      unitAmount: selectedPrice.unit_amount ?? null,
      currency: selectedPrice.currency ?? null,
    })
  }

  return resolved
}

export async function getPriceId(
  stripe: Stripe,
  planKey: PlanKey,
  interval: BillingInterval
): Promise<string> {
  const lookupKey = getPriceLookupKey(planKey, interval)
  const cached = priceIdCacheByLookupKey.get(lookupKey)
  if (cached && isCacheEntryFresh(cached.cachedAtMs)) {
    return cached.priceId
  }

  const refreshed = await refreshCatalogCache(stripe)
  const resolved = refreshed.get(lookupKey)
  if (!resolved) {
    throw new Error(
      `No active Stripe recurring price found for lookup_key "${lookupKey}".`
    )
  }
  return resolved.priceId
}

export async function resolveBillingCatalogFromStripe(
  stripe: Stripe
): Promise<BillingCatalog> {
  const priceByLookupKey = isCatalogCacheFresh()
    ? new Map<string, BillingCatalogPrice>(
        allLookupKeys.map((lookupKey) => [
          lookupKey,
          priceCatalogCacheByLookupKey.get(lookupKey)
            ?.price as BillingCatalogPrice,
        ])
      )
    : await refreshCatalogCache(stripe)

  const catalog = {} as BillingCatalog
  for (const planKey of PLAN_ORDER) {
    catalog[planKey] = {} as Record<BillingInterval, BillingCatalogPrice>
    for (const interval of BILLING_INTERVALS) {
      const lookupKey = getPriceLookupKey(planKey, interval)
      const cachedPrice = priceByLookupKey.get(lookupKey)
      if (!cachedPrice) {
        throw new Error(
          `No Stripe recurring price found for lookup_key "${lookupKey}".`
        )
      }
      catalog[planKey][interval] = cachedPrice
    }
  }

  return catalog
}

export async function mapPriceIdToPlan(
  stripe: Stripe,
  priceId: string | null | undefined
): Promise<ReversePriceMapEntry | null> {
  if (!priceId) return null

  const cached = planInfoCacheByPriceId.get(priceId)
  if (cached && isCacheEntryFresh(cached.cachedAtMs)) {
    return cached.planInfo
  }

  const price = await stripe.prices.retrieve(priceId)
  const planInfo = parseLookupKey(price.lookup_key)

  if (
    planInfo &&
    price.type === "recurring" &&
    price.recurring?.interval === planInfo.interval
  ) {
    planInfoCacheByPriceId.set(priceId, {
      planInfo,
      cachedAtMs: Date.now(),
    })
    return planInfo
  }

  planInfoCacheByPriceId.set(priceId, {
    planInfo: null,
    cachedAtMs: Date.now(),
  })
  return null
}

export function getPlanRank(planKey: PlanKey): number {
  return PLAN_ORDER.indexOf(planKey)
}

/**
 * Monthly token allowance for a plan. Unknown/missing plans fall back to the
 * most restrictive (`personal`) so a misconfigured team can never accidentally
 * get unlimited spend. A negative return means "unlimited".
 */
export function getPlanTokenAllowance(
  planKey: PlanKey | null | undefined
): number {
  if (!planKey) return PLAN_TOKEN_ALLOWANCES.personal
  return PLAN_TOKEN_ALLOWANCES[planKey] ?? PLAN_TOKEN_ALLOWANCES.personal
}

/**
 * Approximate per-MILLION-token USD prices `[input, output]` by model family,
 * matched on a substring of the model wire-name. Used to estimate a Workflows
 * run's cost (`workflowRun.usage.estimatedCostUsd`) for the Runs view — a
 * display/budgeting estimate, NOT a billing source of truth. Calibrate to your
 * provider contracts; unknown models fall back to a conservative default.
 */
const MODEL_PRICE_PER_MTOK: {
  match: string
  input: number
  output: number
}[] = [
  { match: "claude-haiku-4-5", input: 1, output: 5 },
  { match: "claude-opus-4-1", input: 15, output: 75 },
  { match: "claude-sonnet-4-5", input: 3, output: 15 },
  { match: "fable", input: 10, output: 50 },
  { match: "opus", input: 5, output: 25 },
  { match: "sonnet", input: 3, output: 15 },
  { match: "haiku", input: 1, output: 5 },
  { match: "gemini-2.5-pro", input: 1.25, output: 10 },
  { match: "gemini-3.1-pro", input: 2, output: 12 },
  { match: "gemini", input: 0.3, output: 2.5 },
  { match: "gpt-5-nano", input: 0.05, output: 0.4 },
  { match: "gpt-5-mini", input: 0.25, output: 2 },
  { match: "gpt-5.6", input: 5, output: 30 },
  { match: "gpt-5", input: 1.25, output: 10 },
  { match: "gpt", input: 2.5, output: 10 },
  { match: "grok-4-fast", input: 0.2, output: 0.5 },
  { match: "grok-4.5", input: 2, output: 6 },
  { match: "grok-4", input: 3, output: 15 },
  { match: "grok", input: 3, output: 15 },
  { match: "deepseek-chat", input: 0.27, output: 1.1 },
  { match: "deepseek-reasoner", input: 0.55, output: 2.19 },
  { match: "deepseek", input: 0.27, output: 1.1 },
]
const DEFAULT_PRICE_PER_MTOK = { input: 3, output: 15 }

/** Estimated USD cost of a turn/run given its model + token counts. */
export function estimateTokenCostUsd(
  model: string | null | undefined,
  inputTokens: number,
  outputTokens: number
): number {
  const name = (model ?? "").toLowerCase()
  const price =
    MODEL_PRICE_PER_MTOK.find((p) => name.includes(p.match)) ??
    DEFAULT_PRICE_PER_MTOK
  const inTok = Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0
  const outTok = Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0
  return (inTok * price.input + outTok * price.output) / 1_000_000
}
