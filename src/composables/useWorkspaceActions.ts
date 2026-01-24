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
  const createWorkspace = async (
    name: string,
    description?: string,
    photoFile?: File
  ) => {
    return workspaceLoading.withLoading("create", async () => {
      try {
        await workspaceStore.createWorkspace(name, description, photoFile)
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
    updates: {
      name?: string
      description?: string | null
      photoFile?: File | null
    }
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

  // Update workspace photo
  const updateWorkspacePhoto = async (workspaceId: string, file: File) => {
    return workspaceLoading.withLoading(`photo-${workspaceId}`, async () => {
      try {
        await workspaceStore.updateWorkspace(workspaceId, { photoFile: file })
        toast.success("Workspace photo updated successfully")
      } catch (error) {
        toast.error("Failed to update workspace photo", {
          description: (error as Error).message,
        })
        throw error
      }
    })
  }

  // Remove workspace photo
  const removeWorkspacePhoto = async (workspaceId: string) => {
    return workspaceLoading.withLoading(`photo-${workspaceId}`, async () => {
      try {
        await workspaceStore.updateWorkspace(workspaceId, { photoFile: null })
        toast.success("Workspace photo removed successfully")
      } catch (error) {
        toast.error("Failed to remove workspace photo", {
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
    updateWorkspacePhoto,
    removeWorkspacePhoto,
  }
}
