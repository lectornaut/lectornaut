import { useLoadingState } from "@/composables/useLoadingState"
import { useMembershipStore } from "@/stores/membershipStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { storeToRefs } from "pinia"
import { toast } from "vue-sonner"

/**
 * Composable for workspace-related actions with unified loading states and toast notifications
 */
export function useWorkspaceActions() {
  const workspaceStore = useWorkspaceStore()
  const membershipStore = useMembershipStore()

  const {
    workspaces,
    currentWorkspace,
    isLoading: storeLoading,
  } = storeToRefs(workspaceStore)

  const { isOwner, canManageWorkspaces } = storeToRefs(membershipStore)

  // Unified loading states
  const workspaceLoading = useLoadingState<string>()

  // Check if user can delete a workspace (must be owner)
  const canDeleteWorkspace = () => {
    return isOwner.value
  }

  // Check if user can edit a workspace (must be owner)
  const canEditWorkspace = () => {
    return isOwner.value
  }

  // Switch to another workspace
  const switchWorkspace = async (workspaceId: string) => {
    if (currentWorkspace.value?.id === workspaceId) return
    return workspaceLoading.withLoading(workspaceId, async () => {
      try {
        await workspaceStore.switchWorkspace(workspaceId)
        toast.success("Switched workspace successfully")
      } catch (error) {
        toast.error("Failed to switch workspace", {
          description: (error as Error).message,
        })
        throw error
      }
    })
  }

  // Delete a workspace
  const deleteWorkspace = async (workspaceId: string) => {
    return workspaceLoading.withLoading(`delete-${workspaceId}`, async () => {
      try {
        await workspaceStore.deleteWorkspace(workspaceId)
        toast.success("Workspace deleted successfully")
      } catch (error) {
        toast.error("Failed to delete workspace", {
          description: (error as Error).message,
        })
        throw error
      }
    })
  }

  // Create a new workspace
  const createWorkspace = async (name: string, description?: string) => {
    return workspaceLoading.withLoading("create", async () => {
      try {
        await workspaceStore.createWorkspace(name, description)
        toast.success("Workspace created successfully")
      } catch (error) {
        toast.error("Failed to create workspace", {
          description: (error as Error).message,
        })
        throw error
      }
    })
  }

  // Update workspace details
  const updateWorkspace = async (
    workspaceId: string,
    updates: { name?: string; description?: string | null }
  ) => {
    return workspaceLoading.withLoading(`update-${workspaceId}`, async () => {
      try {
        await workspaceStore.updateWorkspace(workspaceId, updates)
        toast.success("Workspace updated successfully")
      } catch (error) {
        toast.error("Failed to update workspace", {
          description: (error as Error).message,
        })
        throw error
      }
    })
  }

  return {
    // State
    currentWorkspace,
    workspaces,
    isLoading: storeLoading,
    isOwner,
    canManageWorkspaces,

    // Loading states
    isWorkspaceLoading: workspaceLoading.isLoading,

    // Permission checks
    canDeleteWorkspace,
    canEditWorkspace,

    // Actions
    switchWorkspace,
    deleteWorkspace,
    createWorkspace,
    updateWorkspace,
  }
}
