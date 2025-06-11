import type { RouteLocationRaw } from "vue-router"

export interface BreadcrumbItem {
  breadcrumb: string
  route: RouteLocationRaw
  isCurrent: boolean
}

export const useRouteBreadcrumbs = () => {
  const router = useRouter()
  const route = useRoute()

  function getRouteSegments(): BreadcrumbItem[] {
    const current = router.currentRoute.value
    const pathSegments = current.path.split("/").filter(Boolean)
    const pathIncrementalSegments = pathSegments.map(
      (_s, idx) => `/${pathSegments.slice(0, idx + 1).join("/")}`
    )
    const matchedRoutes = pathIncrementalSegments.map((s) => router.resolve(s))
    return matchedRoutes
      .filter((r) => r.meta.breadcrumb)
      .map((r, _idx) => {
        let breadcrumb: string
        if (typeof r.meta.breadcrumb === "function") {
          breadcrumb = r.meta.breadcrumb(route)
        } else {
          breadcrumb = String(r.meta.breadcrumb)
        }
        return {
          route: r.path,
          breadcrumb,
          isCurrent: r.name === route.name,
        }
      })
  }

  const items = computed(getRouteSegments)
  return items
}
