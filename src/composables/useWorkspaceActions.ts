import { createActionRunner } from "@/composables/useActionRunner"
import { useLoadingState } from "@/composables/useLoadingState"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { can, Capabilities } from "@/types/permissions"
import { storeToRefs } from "pinia"

/**
 * Workspace actions composable with unified loading states and toast notifications.
 * Wraps workspaceStore operations with loading tracking and user feedback.
 */
export function useWorkspaceActions() {
  const workspaceStore = useWorkspaceStore()
  const membershipStore = useMembershipStore()

  const { workspaces, currentWorkspace, isLoading, isBootstrapping } =
    storeToRefs(workspaceStore)
  const { isOwner, currentUserRole } = storeToRefs(membershipStore)
  const { currentUser } = storeToRefs(useAuthStore()) // We need user for can()
  const loading = useLoadingState<string>()
  const actions = createActionRunner(loading.withLoading)

  const canManageWorkspaces = computed(() =>
    can(currentUser.value, Capabilities.CREATE_WORKSPACE, {
      scope: "team",
      teamRole: currentUserRole.value,
    })
  )

  const canCreateWorkspace = canManageWorkspaces
  const getCannotCreateWorkspaceReason = computed(() =>
    !canManageWorkspaces.value
      ? "Only team owners and admins can create workspaces"
      : null
  )

  // Per-workspace EDIT / DELETE gates. Unlike create (a team-level act), these
  // are workspace-scoped: a team member elevated to admin/owner inside a single
  // workspace — directly or via a group grant — can edit/delete THAT workspace.
  // `can(scope: "workspace")` folds the per-workspace override over the team
  // role elevate-only, so a team admin/owner keeps access to every workspace
  // regardless of any override. Pass the row/dialog workspace id; `null`/absent
  // (e.g. create mode) means "team role only".
  const canUpdateWorkspace = (
    workspaceId: string | null | undefined
  ): boolean =>
    can(currentUser.value, Capabilities.EDIT_WORKSPACE, {
      scope: "workspace",
      teamRole: currentUserRole.value,
      workspaceRole: workspaceId
        ? membershipStore.getWorkspaceRoleOverride(workspaceId)
        : null,
    })
  const getCannotUpdateWorkspaceReason = (
    workspaceId: string | null | undefined
  ): string | null =>
    canUpdateWorkspace(workspaceId)
      ? null
      : "Only owners and admins can update this workspace"

  const canDeleteWorkspace = (
    workspaceId: string | null | undefined
  ): boolean =>
    can(currentUser.value, Capabilities.DELETE_WORKSPACE, {
      scope: "workspace",
      teamRole: currentUserRole.value,
      workspaceRole: workspaceId
        ? membershipStore.getWorkspaceRoleOverride(workspaceId)
        : null,
    })
  const getCannotDeleteWorkspaceReason = (
    workspaceId: string | null | undefined
  ): string | null =>
    canDeleteWorkspace(workspaceId)
      ? null
      : "Only owners and admins can delete this workspace"

  /** Switch to a different workspace */
  const switchWorkspace = async (workspaceId: string) => {
    if (currentWorkspace.value?.id === workspaceId) return
    return actions.run(
      workspaceId,
      () => workspaceStore.switchWorkspace(workspaceId),
      {
        success: "Switched workspace successfully",
        error: "Failed to switch workspace",
      }
    )
  }

  /** Permanently delete a workspace */
  const deleteWorkspace = async (workspaceId: string) =>
    actions.run(
      `delete-${workspaceId}`,
      async () => {
        if (!canDeleteWorkspace(workspaceId)) {
          throw new Error(
            getCannotDeleteWorkspaceReason(workspaceId) ||
              "You do not have permission to delete workspaces"
          )
        }
        await workspaceStore.deleteWorkspace(workspaceId)
      },
      {
        success: "Workspace deleted successfully",
        error: "Failed to delete workspace",
      }
    )

  /** Create a new workspace */
  const createWorkspace = async (
    name: string,
    description?: string,
    photoFile?: File
  ) =>
    actions.run(
      "create",
      async () => {
        if (!canCreateWorkspace.value) {
          throw new Error(
            getCannotCreateWorkspaceReason.value ||
              "You do not have permission to create workspaces"
          )
        }
        // Returns the real workspace id so callers can act on it post-create
        // (e.g. assigning per-workspace roles). `actions.run` propagates it.
        return await workspaceStore.createWorkspace(
          name,
          description,
          photoFile
        )
      },
      {
        success: "Workspace created successfully",
        error: "Failed to create workspace",
      }
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
    actions.run(
      `update-${workspaceId}`,
      async () => {
        if (!canUpdateWorkspace(workspaceId)) {
          throw new Error(
            getCannotUpdateWorkspaceReason(workspaceId) ||
              "You do not have permission to update workspaces"
          )
        }
        await workspaceStore.updateWorkspace(workspaceId, updates)
      },
      {
        success: "Workspace updated successfully",
        error: "Failed to update workspace",
      }
    )

  /** Upload a new workspace photo */
  const updateWorkspacePhoto = async (workspaceId: string, file: File) =>
    actions.run(
      `photo-${workspaceId}`,
      async () => {
        if (!canUpdateWorkspace(workspaceId)) {
          throw new Error(
            getCannotUpdateWorkspaceReason(workspaceId) ||
              "You do not have permission to update workspaces"
          )
        }
        await workspaceStore.updateWorkspace(workspaceId, { photoFile: file })
      },
      {
        info: "Uploading workspace photo...",
        success: "Workspace photo updated successfully",
        error: "Failed to update workspace photo",
      }
    )

  /** Remove the workspace photo */
  const removeWorkspacePhoto = async (workspaceId: string) =>
    actions.run(
      `photo-${workspaceId}`,
      async () => {
        if (!canUpdateWorkspace(workspaceId)) {
          throw new Error(
            getCannotUpdateWorkspaceReason(workspaceId) ||
              "You do not have permission to update workspaces"
          )
        }
        await workspaceStore.updateWorkspace(workspaceId, { photoFile: null })
      },
      {
        success: "Workspace photo removed successfully",
        error: "Failed to remove workspace photo",
      }
    )

  return {
    // State
    currentWorkspace,
    workspaces,
    isLoading,
    isBootstrapping,
    isOwner,
    canManageWorkspaces,

    // Loading - check specific action loading with loading.isLoading(key)
    loading,

    // Permission
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
