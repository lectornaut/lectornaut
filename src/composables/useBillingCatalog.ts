import { useBillingAccess } from "@/composables/useBillingAccess"

export function useBillingCatalog() {
  const { catalog, isCatalogLoading, catalogError, refreshCatalog } =
    useBillingAccess({ loadCatalog: true })

  return {
    billingCatalog: catalog,
    hasCatalog: computed(() => !!catalog.value),
    isLoading: isCatalogLoading,
    error: catalogError,
    refresh: refreshCatalog,
  }
}
