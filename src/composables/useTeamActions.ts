import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamStore } from "@/stores/teamStore"
import type { IMembership } from "@/types"
import { storeToRefs } from "pinia"
import { computed, ref } from "vue"
import { toast } from "vue-sonner"
import { useCurrentUser } from "vuefire"

/**
 * A unified loading state manager for async operations
 */
function useLoadingState<T extends string = string>() {
  const loadingMap = ref<Record<T, boolean>>({} as Record<T, boolean>)

  const isLoading = (key: T) => loadingMap.value[key] ?? false

  const withLoading = async <R>(
    key: T,
    fn: () => Promise<R>
  ): Promise<R | undefined> => {
    loadingMap.value[key] = true
    try {
      return await fn()
    } finally {
      loadingMap.value[key] = false
    }
  }

  return { loadingMap, isLoading, withLoading }
}

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

  // Unified loading states
  const roleLoading = useLoadingState<string>()
  const memberLoading = useLoadingState<string>()
  const teamLoading = useLoadingState<string>()

  // Current user's role in the current team
  const currentUserRole = computed(() => {
    if (!user.value || !currentTeam.value) return null
    const membership = teamMembers.value.find(
      (m) => m.userId === user.value?.uid
    )
    return membership?.role || null
  })

  const isOwner = computed(() => currentUserRole.value === "owner")

  const ownerCount = computed(
    () => teamMembers.value.filter((m) => m.role === "owner").length
  )

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
      try {
        await membershipStore.removeMember(currentTeam.value.id, userId)
        const isCurrentUser = userId === user.value?.uid
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
      try {
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
      try {
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
    role: IMembership["role"] = "member"
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
