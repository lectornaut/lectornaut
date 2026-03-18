import { useFileTreeStore } from "@/stores/fileTreeStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import type { WorkspaceNodeScope } from "@/types/nodes"
import { storeToRefs } from "pinia"
import type {
  RouteLocationNormalizedLoaded,
  RouteLocationRaw,
} from "vue-router"

export const resolveRouteName = (
  route: RouteLocationNormalizedLoaded
): string => {
  const breadcrumb = route.meta?.breadcrumb

  if (typeof breadcrumb === "function") {
    try {
      return String(breadcrumb(route))
    } catch (error) {
      console.error("Failed to resolve breadcrumb function:", error)
    }
  }

  if (breadcrumb) {
    return String(breadcrumb)
  }

  return (route.name as string) || "New tab"
}

export const useNodeBreadcrumb = (
  fallback: string,
  scope: WorkspaceNodeScope
) => {
  const workspaceStore = useWorkspaceStore()
  const fileTreeStore = useFileTreeStore()
  const { currentWorkspace } = storeToRefs(workspaceStore)

  return (route: { params?: { nodeId?: unknown } }) => {
    const rawNodeId = route.params?.nodeId
    const nodeId =
      typeof rawNodeId === "string" && rawNodeId.length ? rawNodeId : null
    const teamId = currentWorkspace.value?.teamId
    const workspaceId = currentWorkspace.value?.id

    if (!nodeId || !teamId || !workspaceId) return fallback

    const node = fileTreeStore.getNode(scope, teamId, workspaceId, nodeId)
    return node?.name || fallback
  }
}

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
