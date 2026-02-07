import { useFileTreeStore } from "@/stores/fileTreeStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import type { WorkspaceNodeScope } from "@/types"
import { storeToRefs } from "pinia"

type BreadcrumbRoute = {
  params?: {
    nodeId?: unknown
  }
}

export const useNodeBreadcrumb = (
  fallback: string,
  scope: WorkspaceNodeScope
) => {
  const workspaceStore = useWorkspaceStore()
  const fileTreeStore = useFileTreeStore()
  const { currentWorkspace } = storeToRefs(workspaceStore)

  return (route: BreadcrumbRoute) => {
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
