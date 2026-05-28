import Stripe from "stripe"

const PLAN_ORDER = [
  "personal",
  "professional",
  "business",
  "enterprise",
] as const

const BILLING_INTERVALS = ["month", "year"] as const
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
