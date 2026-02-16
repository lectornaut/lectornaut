import { createActionRunner } from "@/composables/useActionRunner"
import { useLoadingState } from "@/composables/useLoadingState"
import { defaultTeamRole } from "@/helpers/defaults"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamStore } from "@/stores/teamStore"
import type { IMembership } from "@/types"
import { can, Capabilities, roleCan } from "@/types/permissions"
import { storeToRefs } from "pinia"
import type { Ref } from "vue"
import { useCurrentUser } from "vuefire"

/**
 * Team actions composable with unified loading states and toast notifications.
 * @param targetTeamId - Optional ref to a team ID. When provided, permission checks
 *                       (canInviteMembers, canUpdateTeam, etc.) will use the user's
 *                       role in that team instead of the currently selected team.
 */
export function useTeamActions(targetTeamId?: Ref<string | null | undefined>) {
  const teamStore = useTeamStore()
  const membershipStore = useMembershipStore()
  const user = useCurrentUser()
  const { teamMembers, memberships, currentTeam, isLoading } =
    storeToRefs(teamStore)
  const { isOwner, ownerCount } = storeToRefs(membershipStore)

  // Unified loading state for all team operations
  const loading = {
    role: useLoadingState<string>(),
    member: useLoadingState<string>(),
    team: useLoadingState<string>(),
  }
  const roleActions = createActionRunner(loading.role.withLoading)
  const memberActions = createActionRunner(loading.member.withLoading)
  const teamActions = createActionRunner(loading.team.withLoading)

  // The effective team for permission checks - uses targetTeamId if provided, otherwise currentTeam
  const effectiveTeamId = computed(
    () => targetTeamId?.value ?? currentTeam.value?.id
  )

  // Current user's role in the effective team (target team or current team)
  const currentUserRole = computed(() => {
    if (!user.value || !effectiveTeamId.value) return null
    // If we have a target team ID, look up role from memberships
    const membership = memberships.value.find(
      (m) => m.teamId === effectiveTeamId.value && m.userId === user.value?.uid
    )
    return membership?.role || null
  })

  // Permission checks
  const canChangeRole = (member: IMembership) => {
    // 1. Basic permission check using capability
    if (
      !roleCan(currentUserRole.value, Capabilities.UPDATE_MEMBER_ROLE) &&
      !isOwner.value
    ) {
      // Note: isOwner check is redundant if roleCan works correctly for owner,
      // but keeping strict check for safety if needed, or rely on can().
      // Let's use can() logic which we have in store, but here we might not have full user context easily accessible if we just use roleCan.
      // Actually we have 'user' from useCurrentUser().
      if (
        !can(user.value, Capabilities.UPDATE_MEMBER_ROLE, {
          scope: "team",
          teamRole: currentUserRole.value,
        })
      ) {
        return false
      }
    }

    // 2. Business logic constraints (e.g. last owner)
    // These are NOT pure permissions, but business rules.
    // Changing TO/FROM owner requires owner. (This rule might be part of the capability or separate)
    // The previous logic had: member.role === 'owner' && ownerCount <= 1
    if (member.role === "owner" && ownerCount.value <= 1) {
      return false
    }
    return true
  }

  const getCannotChangeRoleReason = (member: IMembership): string | null => {
    if (
      !can(user.value, Capabilities.UPDATE_MEMBER_ROLE, {
        scope: "team",
        teamRole: currentUserRole.value,
      })
    )
      return "settings.teams.members.noPermissionToChangeRole"
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
    if (
      !can(user.value, Capabilities.REMOVE_MEMBER, {
        scope: "team",
        teamRole: currentUserRole.value,
      }) &&
      member.userId !== user.value?.uid
    )
      return false
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
    roleCan(membership.role, Capabilities.DELETE_TEAM)

  const canUpdateTeam = computed(() =>
    can(user.value, Capabilities.EDIT_TEAM, {
      scope: "team",
      teamRole: currentUserRole.value,
    })
  )
  const getCannotUpdateTeamReason = computed(() =>
    !canUpdateTeam.value ? "Only team owners can update team settings" : null
  )

  const canCreateTeam = computed(() =>
    can(user.value, Capabilities.CREATE_TEAM, { scope: "global" })
  )
  const getCannotCreateTeamReason = computed(() =>
    !canCreateTeam.value ? "Only team owners can create new teams" : null
  )

  const canEditTeam = (membership: IMembership) =>
    roleCan(membership.role, Capabilities.EDIT_TEAM)

  const canManageBilling = computed(() =>
    can(user.value, Capabilities.MANAGE_BILLING, {
      scope: "team",
      teamRole: currentUserRole.value,
    })
  )

  const canInviteMembers = computed(() =>
    can(user.value, Capabilities.INVITE_MEMBER, {
      scope: "team",
      teamRole: currentUserRole.value,
    })
  )
  const getCannotInviteMembersReason = computed(() =>
    !canInviteMembers.value ? "Only admins and owners can invite members" : null
  )

  // Actions using shared loading + toast runner
  const changeRole = async (userId: string, newRole: IMembership["role"]) =>
    roleActions.run(
      userId,
      async () => {
        if (!currentTeam.value) return
        await membershipStore.changeRole(currentTeam.value.id, userId, newRole)
      },
      {
        success: "Role updated successfully",
        error: "Failed to update role",
      }
    )

  const removeMember = async (userId: string) =>
    memberActions.run(
      userId,
      async () => {
        if (!currentTeam.value) return
        await membershipStore.removeMember(currentTeam.value.id, userId)
      },
      {
        success:
          userId === user.value?.uid
            ? "You have left the team"
            : "Member removed successfully",
        error: "Failed to remove member",
      }
    )

  const switchTeam = async (teamId: string) => {
    if (currentTeam.value?.id === teamId) return
    return teamActions.run(teamId, () => teamStore.switchTeam(teamId), {
      success: "Switched team successfully",
      error: "Failed to switch team",
    })
  }

  const exitTeam = async (teamId: string) =>
    teamActions.run(
      `exit-${teamId}`,
      () => membershipStore.removeMember(teamId, user.value!.uid),
      {
        success: "You have left the team",
        error: "Failed to leave team",
      }
    )

  const deleteTeam = async (teamId: string) =>
    teamActions.run(`delete-${teamId}`, () => teamStore.deleteTeam(teamId), {
      success: "Team deleted successfully",
      error: "Failed to delete team",
    })

  const createTeam = async (name: string, photoFile?: File) =>
    teamActions.run("create", () => teamStore.createTeam(name, photoFile), {
      success: "Team created successfully",
      error: "Failed to create team",
    })

  const updateTeam = async (
    teamId: string,
    updates: { name?: string; photoFile?: File | null }
  ) =>
    teamActions.run(
      `update-${teamId}`,
      () => teamStore.updateTeam(teamId, updates),
      {
        success: "Team updated successfully",
        error: "Failed to update team",
      }
    )

  const updateTeamPhoto = async (teamId: string, photoFile: File) =>
    teamActions.run(
      `photo-${teamId}`,
      () => teamStore.updateTeam(teamId, { photoFile }),
      {
        info: "Uploading team photo...",
        success: "Team photo updated",
        error: "Failed to update team photo",
      }
    )

  const removeTeamPhoto = async (teamId: string) =>
    teamActions.run(
      `photo-${teamId}`,
      () => teamStore.updateTeam(teamId, { photoFile: null }),
      {
        success: "Team photo removed",
        error: "Failed to remove team photo",
      }
    )

  const inviteMember = async (
    email: string,
    role: IMembership["role"] = defaultTeamRole
  ) =>
    memberActions.run(
      `invite-${email}`,
      async () => {
        if (!currentTeam.value) return
        await membershipStore.inviteMember(currentTeam.value.id, email, role)
      },
      {
        success: "Member invited successfully",
        error: "Failed to invite member",
      }
    )

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
    canUpdateTeam,
    canCreateTeam,
    canEditTeam,
    canInviteMembers,
    canManageBilling,

    // Disabled state reasons
    getCannotChangeRoleReason,
    getCannotRemoveMemberReason,
    getCannotUpdateTeamReason,
    getCannotCreateTeamReason,
    getCannotInviteMembersReason,

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
