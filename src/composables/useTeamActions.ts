import { useLoadingState } from "@/composables/useLoadingState"
import { defaultTeamRole } from "@/helpers/defaults"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamStore } from "@/stores/teamStore"
import type { IMembership } from "@/types"
import { hasExactRole } from "@/utils/permissions"
import { storeToRefs } from "pinia"
import { toast } from "vue-sonner"
import { useCurrentUser } from "vuefire"

/**
 * Composable for team-related actions with unified loading states and toast notifications
 */
export function useTeamActions() {
  const teamStore = useTeamStore()
  const membershipStore = useMembershipStore()
  const user = useCurrentUser()
  const {
    teamMembers,
    memberships,
    currentTeam,
    isLoading: storeLoading,
  } = storeToRefs(teamStore)

  // Get permission-related computed values from membershipStore (single source of truth)
  const { isOwner, ownerCount, canManageMembers } = storeToRefs(membershipStore)

  // Unified loading states
  const roleLoading = useLoadingState<string>()
  const memberLoading = useLoadingState<string>()
  const teamLoading = useLoadingState<string>()

  // Current user's role in the current team (for returning to consumers)
  const currentUserRole = computed(() => {
    if (!user.value || !currentTeam.value) return null
    const membership = teamMembers.value.find(
      (m) => m.userId === user.value?.uid
    )
    return membership?.role || null
  })

  // Check if role can be changed for a member
  const canChangeRole = (member: IMembership) => {
    if (!isOwner.value) return false
    // Don't allow changing own role if you're the last owner
    if (
      member.userId === user.value?.uid &&
      ownerCount.value <= 1 &&
      member.role === "owner"
    ) {
      return false
    }
    return true
  }

  // Get the reason why role change is disabled
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

  // Check if member can be removed
  const canRemoveMember = (member: IMembership) => {
    // Can't remove if you're not an owner (unless removing yourself)
    if (!isOwner.value && member.userId !== user.value?.uid) return false
    // Can't remove if it's the last member
    if (teamMembers.value.length <= 1) return false
    // Can't remove the last owner
    if (member.role === "owner" && ownerCount.value <= 1) return false
    return true
  }

  // Get the reason why member cannot be removed
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

  // Check if user can exit a specific team
  const canExitTeam = (membership: IMembership) => {
    // Can't exit if it's the last owner
    if (membership.role === "owner") {
      // If it's the current team, we can check the owner count
      if (membership.teamId === currentTeam.value?.id) {
        return ownerCount.value > 1
      }
      // For other teams, we'll return true and let the store/backend handle it
      // or we could check getTeamMemberCount as a hint
      if (membershipStore.getTeamMemberCount(membership.teamId) <= 1) {
        return false
      }
    }
    return true
  }

  // Check if user can delete a team (must be owner of that team)
  const canDeleteTeam = (membership: IMembership) => {
    return hasExactRole(membership.role, "owner")
  }

  // Check if user can invite members to the current team
  const canInviteMembers = () => {
    return canManageMembers.value
  }

  // Change member role
  const changeRole = async (userId: string, newRole: IMembership["role"]) => {
    return roleLoading.withLoading(userId, async () => {
      if (!currentTeam.value) return
      try {
        await membershipStore.changeRole(currentTeam.value.id, userId, newRole)
        toast.success("Role updated successfully")
      } catch (error) {
        toast.error("Failed to update role", {
          description: (error as Error).message,
        })
        throw error
      }
    })
  }

  // Remove member from team
  const removeMember = async (userId: string) => {
    return memberLoading.withLoading(userId, async () => {
      if (!currentTeam.value) return

      const teamIdToRemoveFrom = currentTeam.value.id
      const isCurrentUser = userId === user.value?.uid
      const wasSelectedTeam = currentTeam.value?.id === teamIdToRemoveFrom

      try {
        // Clear the current team optimistically if removing self from selected team
        if (isCurrentUser && wasSelectedTeam) {
          teamStore.clearCurrentTeam()
        }

        await membershipStore.removeMember(teamIdToRemoveFrom, userId)

        toast.success(
          isCurrentUser
            ? "You have left the team"
            : "Member removed successfully"
        )
      } catch (error) {
        toast.error("Failed to remove member", {
          description: (error as Error).message,
        })
        throw error
      }
    })
  }

  // Switch to another team
  const switchTeam = async (teamId: string) => {
    if (currentTeam.value?.id === teamId) return
    return teamLoading.withLoading(teamId, async () => {
      try {
        await teamStore.switchTeam(teamId)
        toast.success("Switched team successfully")
      } catch (error) {
        toast.error("Failed to switch team", {
          description: (error as Error).message,
        })
        throw error
      }
    })
  }

  // Exit/leave the current team
  const exitTeam = async (teamId: string) => {
    return teamLoading.withLoading(`exit-${teamId}`, async () => {
      const wasSelectedTeam = currentTeam.value?.id === teamId

      try {
        // Clear the current team optimistically if exiting the selected team
        if (wasSelectedTeam) {
          teamStore.clearCurrentTeam()
        }

        await membershipStore.removeMember(teamId, user.value!.uid)

        toast.success("You have left the team")
      } catch (error) {
        toast.error("Failed to leave team", {
          description: (error as Error).message,
        })
        throw error
      }
    })
  }

  // Delete a team
  const deleteTeam = async (teamId: string) => {
    return teamLoading.withLoading(`delete-${teamId}`, async () => {
      const wasSelectedTeam = currentTeam.value?.id === teamId

      try {
        // Clear the current team optimistically if deleting the selected team
        if (wasSelectedTeam) {
          teamStore.clearCurrentTeam()
        }

        await teamStore.deleteTeam(teamId)

        toast.success("Team deleted successfully")
      } catch (error) {
        toast.error("Failed to delete team", {
          description: (error as Error).message,
        })
        throw error
      }
    })
  }

  // Create a new team
  const createTeam = async (name: string, photoFile?: File) => {
    return teamLoading.withLoading("create", async () => {
      try {
        await teamStore.createTeam(name, photoFile)
        toast.success("Team created successfully")
      } catch (error) {
        toast.error("Failed to create team", {
          description: (error as Error).message,
        })
        throw error
      }
    })
  }

  // Update team details
  const updateTeam = async (
    teamId: string,
    updates: { name?: string; photoFile?: File | null }
  ) => {
    return teamLoading.withLoading(`update-${teamId}`, async () => {
      try {
        await teamStore.updateTeam(teamId, updates)
        toast.success("Team updated successfully")
      } catch (error) {
        toast.error("Failed to update team", {
          description: (error as Error).message,
        })
        throw error
      }
    })
  }

  // Update team photo
  const updateTeamPhoto = async (teamId: string, photoFile: File) => {
    return teamLoading.withLoading(`photo-${teamId}`, async () => {
      try {
        toast.info("Uploading team photo...")
        await teamStore.updateTeam(teamId, { photoFile })
        toast.success("Team photo updated")
      } catch (error) {
        toast.error("Failed to update team photo", {
          description: (error as Error).message,
        })
        throw error
      }
    })
  }

  // Remove team photo
  const removeTeamPhoto = async (teamId: string) => {
    return teamLoading.withLoading(`photo-${teamId}`, async () => {
      try {
        await teamStore.updateTeam(teamId, { photoFile: null })
        toast.success("Team photo removed")
      } catch (error) {
        toast.error("Failed to remove team photo", {
          description: (error as Error).message,
        })
        throw error
      }
    })
  }

  // Invite a member to the team
  const inviteMember = async (
    email: string,
    role: IMembership["role"] = defaultTeamRole
  ) => {
    return memberLoading.withLoading(`invite-${email}`, async () => {
      if (!currentTeam.value) return
      try {
        await membershipStore.inviteMember(
          currentTeam.value.id,
          currentTeam.value,
          email,
          role
        )
        toast.success("Member invited successfully")
      } catch (error) {
        toast.error("Failed to invite member", {
          description: (error as Error).message,
        })
        throw error
      }
    })
  }

  return {
    // State
    currentTeam,
    teamMembers,
    memberships,
    isLoading: storeLoading,
    currentUserRole,
    isOwner,
    ownerCount,

    // Loading states
    isRoleLoading: roleLoading.isLoading,
    isMemberLoading: memberLoading.isLoading,
    isTeamLoading: teamLoading.isLoading,

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
