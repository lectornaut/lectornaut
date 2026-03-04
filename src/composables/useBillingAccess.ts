import { useBillingStore } from "@/stores/billingStore"
import { storeToRefs } from "pinia"

export type {
  BillingFeatureKey,
  BillingFeatureRule,
} from "@/stores/billingStore"

export function useBillingAccess(options: { loadCatalog?: boolean } = {}) {
  const billingStore = useBillingStore()
  const {
    catalog,
    isCatalogLoading,
    catalogError,
    billing,
    isBillingKnown,
    isBillingLoading,
    billingError,
    isEntitled,
    planKey,
    interval,
    status,
    planRank,
  } = storeToRefs(billingStore)

  if (options.loadCatalog) {
    void billingStore.ensureCatalogLoaded()
  }

  return {
    billing,
    isBillingKnown,
    isBillingLoading,
    billingError,
    isEntitled,
    planKey,
    interval,
    status,
    planRank,

    catalog,
    isCatalogLoading,
    catalogError,

    refreshCatalog: billingStore.refreshCatalog,
    refreshBilling: billingStore.refreshBilling,
    hasPlanAtLeast: billingStore.hasPlanAtLeast,
    canUseFeature: billingStore.canUseFeature,
  }
}
