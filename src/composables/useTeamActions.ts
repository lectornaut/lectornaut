import { useLoadingState } from "@/composables/useLoadingState"
import { defaultTeamRole } from "@/helpers/defaults"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamStore } from "@/stores/teamStore"
import type { IMembership } from "@/types"
import { hasExactRole } from "@/utils/permissions"
import { withToast } from "@/utils/toast-helpers"
import { storeToRefs } from "pinia"
import { useCurrentUser } from "vuefire"

/**
 * Team actions composable with unified loading states and toast notifications.
 */
export function useTeamActions() {
  const teamStore = useTeamStore()
  const membershipStore = useMembershipStore()
  const user = useCurrentUser()
  const { teamMembers, memberships, currentTeam, isLoading } =
    storeToRefs(teamStore)
  const { isOwner, ownerCount, canManageMembers } = storeToRefs(membershipStore)

  // Unified loading state for all team operations
  const loading = {
    role: useLoadingState<string>(),
    member: useLoadingState<string>(),
    team: useLoadingState<string>(),
  }

  // Current user's role in the current team
  const currentUserRole = computed(() => {
    if (!user.value || !currentTeam.value) return null
    const membership = teamMembers.value.find(
      (m) => m.userId === user.value?.uid
    )
    return membership?.role || null
  })

  // Permission checks
  const canChangeRole = (member: IMembership) => {
    if (!isOwner.value) return false
    if (
      member.userId === user.value?.uid &&
      ownerCount.value <= 1 &&
      member.role === "owner"
    ) {
      return false
    }
    return true
  }

  const getCannotChangeRoleReason = (member: IMembership): string | null => {
    if (!isOwner.value) return "settings.teams.members.noPermissionToChangeRole"
    if (
      member.userId === user.value?.uid &&
      ownerCount.value <= 1 &&
      member.role === "owner"
    ) {
      return "settings.teams.members.lastOwnerCannotChangeRole"
    }
    return null
  }

  const canRemoveMember = (member: IMembership) => {
    if (!isOwner.value && member.userId !== user.value?.uid) return false
    if (teamMembers.value.length <= 1) return false
    if (member.role === "owner" && ownerCount.value <= 1) return false
    return true
  }

  const getCannotRemoveMemberReason = (member: IMembership): string | null => {
    if (!isOwner.value && member.userId !== user.value?.uid) {
      return "settings.teams.members.noPermissionToRemove"
    }
    if (teamMembers.value.length <= 1) {
      return "settings.teams.members.lastMemberCannotBeRemoved"
    }
    if (member.role === "owner" && ownerCount.value <= 1) {
      return "settings.teams.members.lastOwnerCannotBeRemoved"
    }
    return null
  }

  const canExitTeam = (membership: IMembership) => {
    if (membership.role === "owner") {
      if (membership.teamId === currentTeam.value?.id) {
        return ownerCount.value > 1
      }
      if (membershipStore.getTeamMemberCount(membership.teamId) <= 1) {
        return false
      }
    }
    return true
  }

  const canDeleteTeam = (membership: IMembership) =>
    hasExactRole(membership.role, "owner")
  const canInviteMembers = () => canManageMembers.value

  // Actions using withToast utility
  const changeRole = async (userId: string, newRole: IMembership["role"]) =>
    loading.role.withLoading(userId, async () => {
      if (!currentTeam.value) return
      await withToast(
        () =>
          membershipStore.changeRole(currentTeam.value!.id, userId, newRole),
        {
          success: "Role updated successfully",
          error: "Failed to update role",
        }
      )
    })

  const removeMember = async (userId: string) =>
    loading.member.withLoading(userId, async () => {
      if (!currentTeam.value) return
      const teamIdToRemoveFrom = currentTeam.value.id
      const isCurrentUser = userId === user.value?.uid
      const wasSelectedTeam = currentTeam.value?.id === teamIdToRemoveFrom

      if (isCurrentUser && wasSelectedTeam) {
        teamStore.clearCurrentTeam()
      }

      await withToast(
        () => membershipStore.removeMember(teamIdToRemoveFrom, userId),
        {
          success: isCurrentUser
            ? "You have left the team"
            : "Member removed successfully",
          error: "Failed to remove member",
        }
      )
    })

  const switchTeam = async (teamId: string) => {
    if (currentTeam.value?.id === teamId) return
    return loading.team.withLoading(teamId, () =>
      withToast(() => teamStore.switchTeam(teamId), {
        success: "Switched team successfully",
        error: "Failed to switch team",
      })
    )
  }

  const exitTeam = async (teamId: string) =>
    loading.team.withLoading(`exit-${teamId}`, async () => {
      const wasSelectedTeam = currentTeam.value?.id === teamId
      if (wasSelectedTeam) {
        teamStore.clearCurrentTeam()
      }
      await withToast(
        () => membershipStore.removeMember(teamId, user.value!.uid),
        {
          success: "You have left the team",
          error: "Failed to leave team",
        }
      )
    })

  const deleteTeam = async (teamId: string) =>
    loading.team.withLoading(`delete-${teamId}`, async () => {
      const wasSelectedTeam = currentTeam.value?.id === teamId
      if (wasSelectedTeam) {
        teamStore.clearCurrentTeam()
      }
      await withToast(() => teamStore.deleteTeam(teamId), {
        success: "Team deleted successfully",
        error: "Failed to delete team",
      })
    })

  const createTeam = async (name: string, photoFile?: File) =>
    loading.team.withLoading("create", () =>
      withToast(() => teamStore.createTeam(name, photoFile), {
        success: "Team created successfully",
        error: "Failed to create team",
      })
    )

  const updateTeam = async (
    teamId: string,
    updates: { name?: string; photoFile?: File | null }
  ) =>
    loading.team.withLoading(`update-${teamId}`, () =>
      withToast(() => teamStore.updateTeam(teamId, updates), {
        success: "Team updated successfully",
        error: "Failed to update team",
      })
    )

  const updateTeamPhoto = async (teamId: string, photoFile: File) =>
    loading.team.withLoading(`photo-${teamId}`, () =>
      withToast(() => teamStore.updateTeam(teamId, { photoFile }), {
        info: "Uploading team photo...",
        success: "Team photo updated",
        error: "Failed to update team photo",
      })
    )

  const removeTeamPhoto = async (teamId: string) =>
    loading.team.withLoading(`photo-${teamId}`, () =>
      withToast(() => teamStore.updateTeam(teamId, { photoFile: null }), {
        success: "Team photo removed",
        error: "Failed to remove team photo",
      })
    )

  const inviteMember = async (
    email: string,
    role: IMembership["role"] = defaultTeamRole
  ) =>
    loading.member.withLoading(`invite-${email}`, async () => {
      if (!currentTeam.value) return
      await withToast(
        () =>
          membershipStore.inviteMember(
            currentTeam.value!.id,
            currentTeam.value!,
            email,
            role
          ),
        {
          success: "Member invited successfully",
          error: "Failed to invite member",
        }
      )
    })

  return {
    // State
    currentTeam,
    teamMembers,
    memberships,
    isLoading,
    currentUserRole,
    isOwner,
    ownerCount,

    // Loading - check with loading.role.isLoading(key), loading.member.isLoading(key), etc.
    loading,

    // Permission checks
    canChangeRole,
    canRemoveMember,
    canExitTeam,
    canDeleteTeam,
    canInviteMembers,

    // Disabled state reasons
    getCannotChangeRoleReason,
    getCannotRemoveMemberReason,

    // Member counts
    getTeamMemberCount: membershipStore.getTeamMemberCount,

    // Actions
    changeRole,
    removeMember,
    switchTeam,
    exitTeam,
    deleteTeam,
    createTeam,
    updateTeam,
    updateTeamPhoto,
    removeTeamPhoto,
    inviteMember,
  }
}
