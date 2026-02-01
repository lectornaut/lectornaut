import { resolveRouteName } from "@/helpers/route"
import type {
  RouteLocationNormalizedLoaded,
  RouteLocationRaw,
} from "vue-router"

export interface BreadcrumbItem {
  breadcrumb: string
  route: RouteLocationRaw
  isCurrent: boolean
}

/**
 * Composable for generating breadcrumbs based on the current route
 * Parses route segments and resolves their metadata to build the breadcrumb trail
 */
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
        const breadcrumb = resolveRouteName(
          r as unknown as RouteLocationNormalizedLoaded
        )
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
