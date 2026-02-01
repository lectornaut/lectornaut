import { useLoadingState } from "@/composables/useLoadingState"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { can, Capabilities } from "@/utils/permissions"
import { withToast } from "@/utils/toast-helpers"
import { storeToRefs } from "pinia"

/**
 * Workspace actions composable with unified loading states and toast notifications.
 * Wraps workspaceStore operations with loading tracking and user feedback.
 */
export function useWorkspaceActions() {
  const workspaceStore = useWorkspaceStore()
  const membershipStore = useMembershipStore()

  const { workspaces, currentWorkspace, isLoading } =
    storeToRefs(workspaceStore)
  const { isOwner, currentUserRole } = storeToRefs(membershipStore)
  const { currentUser } = storeToRefs(useAuthStore()) // We need user for can()
  const loading = useLoadingState<string>()

  const canManageWorkspaces = computed(() =>
    can(currentUser.value, Capabilities.CREATE_WORKSPACE, {
      scope: "team",
      teamRole: currentUserRole.value,
    })
  )

  const canCreateWorkspace = computed(() => canManageWorkspaces.value)
  const getCannotCreateWorkspaceReason = computed(() =>
    !canManageWorkspaces.value
      ? "Only members and above can create workspaces"
      : null
  )

  const canUpdateWorkspace = computed(() =>
    can(currentUser.value, Capabilities.EDIT_WORKSPACE, {
      scope: "team",
      teamRole: currentUserRole.value,
    })
  )
  const getCannotUpdateWorkspaceReason = computed(() =>
    !canUpdateWorkspace.value
      ? "Only members and above can update workspaces"
      : null
  )

  const canDeleteWorkspace = computed(() =>
    can(currentUser.value, Capabilities.DELETE_WORKSPACE, {
      scope: "team",
      teamRole: currentUserRole.value,
    })
  )
  const getCannotDeleteWorkspaceReason = computed(() =>
    !canDeleteWorkspace.value
      ? "Only members and above can delete workspaces"
      : null
  )

  /** Switch to a different workspace */
  const switchWorkspace = async (workspaceId: string) => {
    if (currentWorkspace.value?.id === workspaceId) return
    return loading.withLoading(workspaceId, () =>
      withToast(() => workspaceStore.switchWorkspace(workspaceId), {
        success: "Switched workspace successfully",
        error: "Failed to switch workspace",
      })
    )
  }

  /** Permanently delete a workspace */
  const deleteWorkspace = async (workspaceId: string) =>
    loading.withLoading(`delete-${workspaceId}`, () =>
      withToast(() => workspaceStore.deleteWorkspace(workspaceId), {
        success: "Workspace deleted successfully",
        error: "Failed to delete workspace",
      })
    )

  /** Create a new workspace */
  const createWorkspace = async (
    name: string,
    description?: string,
    photoFile?: File
  ) =>
    loading.withLoading("create", () =>
      withToast(
        () => workspaceStore.createWorkspace(name, description, photoFile),
        {
          success: "Workspace created successfully",
          error: "Failed to create workspace",
        }
      )
    )

  /** Update workspace details (name, description, photo) */
  const updateWorkspace = async (
    workspaceId: string,
    updates: {
      name?: string
      description?: string | null
      photoFile?: File | null
    }
  ) =>
    loading.withLoading(`update-${workspaceId}`, () =>
      withToast(() => workspaceStore.updateWorkspace(workspaceId, updates), {
        success: "Workspace updated successfully",
        error: "Failed to update workspace",
      })
    )

  /** Upload a new workspace photo */
  const updateWorkspacePhoto = async (workspaceId: string, file: File) =>
    loading.withLoading(`photo-${workspaceId}`, () =>
      withToast(
        () => workspaceStore.updateWorkspace(workspaceId, { photoFile: file }),
        {
          info: "Uploading workspace photo...",
          success: "Workspace photo updated successfully",
          error: "Failed to update workspace photo",
        }
      )
    )

  /** Remove the workspace photo */
  const removeWorkspacePhoto = async (workspaceId: string) =>
    loading.withLoading(`photo-${workspaceId}`, () =>
      withToast(
        () => workspaceStore.updateWorkspace(workspaceId, { photoFile: null }),
        {
          success: "Workspace photo removed successfully",
          error: "Failed to remove workspace photo",
        }
      )
    )

  return {
    // State
    currentWorkspace,
    workspaces,
    isLoading,
    isOwner,
    canManageWorkspaces,

    // Loading - check specific action loading with loading.isLoading(key)
    loading,

    // Permission
    canManageWorkspace: canManageWorkspaces,
    canCreateWorkspace,
    canUpdateWorkspace,
    canDeleteWorkspace,

    // Reasons
    getCannotCreateWorkspaceReason,
    getCannotUpdateWorkspaceReason,
    getCannotDeleteWorkspaceReason,

    // Actions
    switchWorkspace,
    deleteWorkspace,
    createWorkspace,
    updateWorkspace,
    updateWorkspacePhoto,
    removeWorkspacePhoto,
  }
}
