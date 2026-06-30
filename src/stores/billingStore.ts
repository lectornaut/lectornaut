import {
  getBillingCatalog,
  getBillingStatus,
  type BillingCatalog,
  type BillingPlanKey,
  type BillingStatusData,
} from "@/composables/useFunctions"
import {
  getBillingPlanRank,
  hasPlanAtLeast as hasPlanAtLeastByRank,
  isTeamBillingEntitled,
  normalizeTeamBilling,
} from "@/helpers/billing"
import { useTeamStore } from "@/stores/teamStore"
import { defineStore, storeToRefs } from "pinia"
import { useCurrentUser } from "vuefire"

export type BillingFeatureKey =
  "paid" | "professional_plus" | "business_plus" | "enterprise_only"

export interface BillingFeatureRule {
  minPlan: BillingPlanKey
  requiresEntitlement?: boolean
}

const BILLING_FEATURE_RULES: Record<BillingFeatureKey, BillingFeatureRule> = {
  paid: { minPlan: "personal" },
  professional_plus: { minPlan: "professional" },
  business_plus: { minPlan: "business" },
  enterprise_only: { minPlan: "enterprise" },
}

export const useBillingStore = defineStore("billing", () => {
  const teamStore = useTeamStore()
  const { currentTeam, isLoading: isTeamLoading } = storeToRefs(teamStore)
  const currentUser = useCurrentUser()

  const catalog = ref<BillingCatalog | null>(null)
  const isCatalogLoading = ref(false)
  const catalogError = ref<string | null>(null)
  const lastLoadedAt = ref<number | null>(null)

  const billingSnapshot = ref<BillingStatusData | null>(null)
  const billingSnapshotTeamId = ref<string | null>(null)
  const isBillingLoading = ref(false)
  const billingError = ref<string | null>(null)
  const lastBillingLoadedAt = ref<number | null>(null)

  let catalogRequestId = 0
  let billingRequestId = 0
  let catalogLoadPromise: Promise<BillingCatalog | null> | null = null
  const billingLoadPromises = new Map<
    string,
    Promise<BillingStatusData | null>
  >()

  const currentTeamId = computed(() => currentTeam.value?.id ?? null)

  watch(
    () => [currentTeam.value?.id, currentTeam.value?.billing] as const,
    ([teamId, teamBilling]) => {
      if (!teamId) {
        billingSnapshotTeamId.value = null
        billingSnapshot.value = null
        billingError.value = null
        lastBillingLoadedAt.value = null
        return
      }

      billingSnapshotTeamId.value = teamId
      billingSnapshot.value = teamBilling
        ? normalizeTeamBilling(teamBilling)
        : null
      billingError.value = null
      lastBillingLoadedAt.value = Date.now()
    },
    { immediate: true }
  )

  const billing = computed(() => {
    if (!currentTeamId.value) return null
    if (billingSnapshotTeamId.value !== currentTeamId.value) return null
    return billingSnapshot.value
  })

  const isBillingKnown = computed(() => {
    if (!currentTeamId.value) return false
    if (isTeamLoading.value) return false
    return billingSnapshotTeamId.value === currentTeamId.value
  })

  const planKey = computed(() => billing.value?.planKey ?? null)
  const interval = computed(() => billing.value?.interval ?? null)
  const status = computed(() => billing.value?.status ?? null)
  const isEntitled = computed(() => {
    if (!isBillingKnown.value) return false
    return isTeamBillingEntitled(billing.value)
  })

  const planRank = computed(() => {
    if (!isBillingKnown.value || !isEntitled.value || !planKey.value) return -1
    return getBillingPlanRank(planKey.value)
  })

  const hasPlanAtLeast = (requiredPlan: BillingPlanKey): boolean => {
    if (!isBillingKnown.value || !isEntitled.value) return false
    return hasPlanAtLeastByRank(planKey.value, requiredPlan)
  }

  const canUseFeature = (
    feature: BillingFeatureKey | BillingFeatureRule
  ): boolean => {
    const resolvedRule =
      typeof feature === "string" ? BILLING_FEATURE_RULES[feature] : feature
    if (!resolvedRule) return false

    if (!isBillingKnown.value) return false

    const requiresEntitlement = resolvedRule.requiresEntitlement ?? true
    if (requiresEntitlement && !isEntitled.value) return false

    return hasPlanAtLeastByRank(planKey.value, resolvedRule.minPlan)
  }

  const refreshCatalog = async (
    options: { force?: boolean } = {}
  ): Promise<BillingCatalog | null> => {
    if (!options.force && catalog.value && !catalogError.value) {
      return catalog.value
    }

    if (catalogLoadPromise && !options.force) {
      return catalogLoadPromise
    }

    catalogRequestId += 1
    const activeRequestId = catalogRequestId
    const request = (async () => {
      isCatalogLoading.value = true
      catalogError.value = null

      try {
        const { data } = await getBillingCatalog({})
        if (activeRequestId !== catalogRequestId) return catalog.value
        catalog.value = data.prices ?? null
        lastLoadedAt.value = Date.now()
      } catch (error) {
        if (activeRequestId !== catalogRequestId) return catalog.value
        catalog.value = null
        catalogError.value =
          error instanceof Error ? error.message : String(error)
      } finally {
        if (activeRequestId === catalogRequestId) {
          isCatalogLoading.value = false
        }
      }

      return catalog.value
    })()

    catalogLoadPromise = request

    try {
      return await request
    } finally {
      if (catalogLoadPromise === request) {
        catalogLoadPromise = null
      }
    }
  }

  const ensureCatalogLoaded = async (): Promise<BillingCatalog | null> => {
    if (catalog.value) return catalog.value
    if (catalogLoadPromise) return catalogLoadPromise
    return refreshCatalog()
  }

  const refreshBilling = async (
    teamId = currentTeamId.value,
    options: { force?: boolean } = {}
  ): Promise<BillingStatusData | null> => {
    if (!teamId) return null

    const existingRequest = billingLoadPromises.get(teamId)
    if (existingRequest && !options.force) {
      return existingRequest
    }

    billingRequestId += 1
    const activeRequestId = billingRequestId
    const request = (async () => {
      isBillingLoading.value = true
      if (teamId === currentTeamId.value) {
        billingError.value = null
      }

      try {
        const { data } = await getBillingStatus({ teamId })
        const normalizedBilling = normalizeTeamBilling(data.billing)

        if (activeRequestId !== billingRequestId) {
          return teamId === currentTeamId.value
            ? billing.value
            : normalizedBilling
        }

        if (teamId === currentTeamId.value) {
          billingSnapshotTeamId.value = teamId
          billingSnapshot.value = normalizedBilling
          lastBillingLoadedAt.value = Date.now()
        }

        return normalizedBilling
      } catch (error) {
        if (activeRequestId !== billingRequestId) return billing.value

        if (teamId === currentTeamId.value) {
          billingError.value =
            error instanceof Error ? error.message : String(error)
        }

        return teamId === currentTeamId.value ? billing.value : null
      } finally {
        if (activeRequestId === billingRequestId) {
          isBillingLoading.value = false
        }
      }
    })()

    billingLoadPromises.set(teamId, request)

    try {
      return await request
    } finally {
      if (billingLoadPromises.get(teamId) === request) {
        billingLoadPromises.delete(teamId)
      }
    }
  }

  watch(
    currentTeamId,
    (teamId, previousTeamId) => {
      if (!teamId || teamId === previousTeamId) return
      void refreshBilling(teamId)
    },
    { immediate: true }
  )

  /**
   * Clears all billing state, including the team-independent catalog/promise
   * caches. Unlike the team watch above (which only tracks `currentTeam`), this
   * is the only path that resets the cross-team `catalog`, `catalogError`,
   * `lastLoadedAt`, and the in-flight promise maps. Bumping the request IDs
   * discards any in-flight responses so they can't write after the reset.
   */
  const resetBillingState = () => {
    catalogRequestId += 1
    billingRequestId += 1
    catalogLoadPromise = null
    billingLoadPromises.clear()

    catalog.value = null
    isCatalogLoading.value = false
    catalogError.value = null
    lastLoadedAt.value = null

    billingSnapshot.value = null
    billingSnapshotTeamId.value = null
    isBillingLoading.value = false
    billingError.value = null
    lastBillingLoadedAt.value = null
  }

  // Reset billing when the signed-in user changes. Guarded to fire only on
  // logout or an account switch — NOT on the initial undefined→uid resolution,
  // which would otherwise discard the first billing load the team watch above
  // kicks off during startup. (Previously billing state leaked across sessions:
  // a new user could briefly see the previous user's cached catalog/errors.)
  watch(
    () => currentUser.value?.uid ?? null,
    (uid, previousUid) => {
      if (!previousUid || uid === previousUid) return
      resetBillingState()
    }
  )

  return {
    catalog,
    isCatalogLoading,
    catalogError,
    lastLoadedAt,

    billing,
    isBillingKnown,
    isBillingLoading,
    billingError,
    lastBillingLoadedAt,
    isEntitled,
    planKey,
    interval,
    status,
    planRank,

    ensureCatalogLoaded,
    refreshCatalog,
    refreshBilling,
    hasPlanAtLeast,
    canUseFeature,
  }
})
