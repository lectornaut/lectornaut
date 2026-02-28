import { createActionRunner } from "@/composables/useActionRunner"
import { useLoadingState } from "@/composables/useLoadingState"
import { defaultTeamRole } from "@/helpers/defaults"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamStore } from "@/stores/teamStore"
import type { IMembership } from "@/types/membership"
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
  const { ownerCount } = storeToRefs(membershipStore)

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
  const isOwner = computed(() => currentUserRole.value === "owner")

  // Permission checks
  const canChangeRole = (member: IMembership) => {
    if (
      !can(user.value, Capabilities.UPDATE_MEMBER_ROLE, {
        scope: "team",
        teamRole: currentUserRole.value,
      })
    ) {
      return false
    }

    // Owner role transitions are owner-only.
    if (member.role === "owner" && currentUserRole.value !== "owner") {
      return false
    }

    // Business logic constraints (e.g. last owner).
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
    if (member.role === "owner" && currentUserRole.value !== "owner") {
      return "settings.teams.members.onlyOwnersCanManageOwners"
    }
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
    if (member.role === "owner" && currentUserRole.value !== "owner")
      return false
    if (teamMembers.value.length <= 1) return false
    if (member.role === "owner" && ownerCount.value <= 1) return false
    return true
  }

  const getCannotRemoveMemberReason = (member: IMembership): string | null => {
    if (
      !can(user.value, Capabilities.REMOVE_MEMBER, {
        scope: "team",
        teamRole: currentUserRole.value,
      }) &&
      member.userId !== user.value?.uid
    ) {
      return "settings.teams.members.noPermissionToRemove"
    }
    if (member.role === "owner" && currentUserRole.value !== "owner") {
      return "settings.teams.members.onlyOwnersCanManageOwners"
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
  const getCannotExitTeamReason = (membership: IMembership): string | null => {
    if (canExitTeam(membership)) return null
    if (
      membership.role === "owner" &&
      membership.teamId === currentTeam.value?.id &&
      ownerCount.value <= 1
    ) {
      return "Cannot exit the last owner of this team"
    }
    if (
      membership.role === "owner" &&
      membershipStore.getTeamMemberCount(membership.teamId) <= 1
    ) {
      return "Cannot exit the only member of this team"
    }
    return "You do not have permission to leave this team"
  }

  const canDeleteTeam = (membership: IMembership) =>
    roleCan(membership.role, Capabilities.DELETE_TEAM)
  const getCannotDeleteTeamReason = (membership: IMembership): string | null =>
    canDeleteTeam(membership) ? null : "Only team owners can delete teams"

  const canUpdateTeam = computed(() =>
    can(user.value, Capabilities.EDIT_TEAM, {
      scope: "team",
      teamRole: currentUserRole.value,
    })
  )
  const getCannotUpdateTeamReason = computed(() =>
    !canUpdateTeam.value
      ? "Only team owners and admins can update team settings"
      : null
  )

  const canCreateTeam = computed(() =>
    can(user.value, Capabilities.CREATE_TEAM, { scope: "global" })
  )
  const getCannotCreateTeamReason = computed(() =>
    !canCreateTeam.value ? "You must be signed in to create a team" : null
  )

  const canEditTeam = (membership: IMembership) =>
    roleCan(membership.role, Capabilities.EDIT_TEAM)
  const getCannotEditTeamReason = (membership: IMembership): string | null =>
    canEditTeam(membership)
      ? null
      : "Only team owners and admins can update team settings"

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
        const teamId = effectiveTeamId.value
        if (!teamId) return
        const targetMember = teamMembers.value.find((m) => m.userId === userId)
        if (
          currentUserRole.value !== "owner" &&
          (newRole === "owner" || targetMember?.role === "owner")
        ) {
          throw new Error("Only team owners can manage owner roles")
        }
        await membershipStore.changeRole(teamId, userId, newRole)
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
        const teamId = effectiveTeamId.value
        if (!teamId) return
        await membershipStore.removeMember(teamId, userId)
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
    const membership = memberships.value.find((m) => m.teamId === teamId)
    if (!membership) {
      throw new Error("You do not belong to this team")
    }
    return teamActions.run(teamId, () => teamStore.switchTeam(teamId), {
      success: "Switched team successfully",
      error: "Failed to switch team",
    })
  }

  const exitTeam = async (teamId: string) =>
    teamActions.run(
      `exit-${teamId}`,
      async () => {
        const membership = memberships.value.find((m) => m.teamId === teamId)
        if (!membership) {
          throw new Error("You do not belong to this team")
        }
        const cannotReason = getCannotExitTeamReason(membership)
        if (cannotReason) {
          throw new Error(cannotReason)
        }
        await membershipStore.removeMember(teamId, user.value!.uid)
      },
      {
        success: "You have left the team",
        error: "Failed to leave team",
      }
    )

  const deleteTeam = async (teamId: string) =>
    teamActions.run(
      `delete-${teamId}`,
      async () => {
        const membership = memberships.value.find((m) => m.teamId === teamId)
        if (!membership) {
          throw new Error("You do not belong to this team")
        }
        const cannotReason = getCannotDeleteTeamReason(membership)
        if (cannotReason) {
          throw new Error(cannotReason)
        }
        await teamStore.deleteTeam(teamId)
      },
      {
        success: "Team deleted successfully",
        error: "Failed to delete team",
      }
    )

  const createTeam = async (
    name: string,
    options?: {
      photoFile?: File
      username?: string
      isPublic?: boolean
    }
  ) =>
    teamActions.run(
      "create",
      async () => {
        if (!canCreateTeam.value) {
          throw new Error(
            getCannotCreateTeamReason.value ||
              "You do not have permission to create teams"
          )
        }
        return teamStore.createTeam(name, options)
      },
      {
        success: "Team created successfully",
        error: "Failed to create team",
      }
    )

  const updateTeam = async (
    teamId: string,
    updates: {
      name?: string
      photoFile?: File | null
      username?: string | null
      isPublic?: boolean
    }
  ) =>
    teamActions.run(
      `update-${teamId}`,
      async () => {
        if (!canUpdateTeam.value) {
          throw new Error(
            getCannotUpdateTeamReason.value ||
              "You do not have permission to update teams"
          )
        }
        await teamStore.updateTeam(teamId, updates)
      },
      {
        success: "Team updated successfully",
        error: "Failed to update team",
      }
    )

  const updateTeamPhoto = async (teamId: string, photoFile: File) =>
    teamActions.run(
      `photo-${teamId}`,
      async () => {
        const membership = memberships.value.find((m) => m.teamId === teamId)
        if (!membership) {
          throw new Error("You do not belong to this team")
        }
        const cannotReason = getCannotEditTeamReason(membership)
        if (cannotReason) {
          throw new Error(cannotReason)
        }
        await teamStore.updateTeam(teamId, { photoFile })
      },
      {
        info: "Uploading team photo...",
        success: "Team photo updated",
        error: "Failed to update team photo",
      }
    )

  const removeTeamPhoto = async (teamId: string) =>
    teamActions.run(
      `photo-${teamId}`,
      async () => {
        const membership = memberships.value.find((m) => m.teamId === teamId)
        if (!membership) {
          throw new Error("You do not belong to this team")
        }
        const cannotReason = getCannotEditTeamReason(membership)
        if (cannotReason) {
          throw new Error(cannotReason)
        }
        await teamStore.updateTeam(teamId, { photoFile: null })
      },
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
        const teamId = effectiveTeamId.value
        if (!teamId) return
        if (!canInviteMembers.value) {
          throw new Error(
            getCannotInviteMembersReason.value ||
              "You do not have permission to invite members"
          )
        }
        await membershipStore.inviteMember(teamId, email, role)
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
    getCannotExitTeamReason,
    getCannotDeleteTeamReason,
    getCannotEditTeamReason,
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
