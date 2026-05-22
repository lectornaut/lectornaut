import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import { can, Capabilities } from "@/types/permissions"
import { storeToRefs } from "pinia"
import { computed, type Ref } from "vue"

/**
 * Resolves the current user's role in a given team from memberships.
 * Shared by composables that need role-based permission checks for a specific team.
 */
export function useCurrentTeamRole(teamId: Ref<string | null>) {
  const { currentUser } = storeToRefs(useAuthStore())
  const { memberships } = storeToRefs(useMembershipStore())

  const currentRole = computed(() => {
    if (!teamId.value || !currentUser.value) return null
    return (
      memberships.value.find(
        (m) => m.teamId === teamId.value && m.userId === currentUser.value?.uid
      )?.role ?? null
    )
  })

  const canViewLogs = computed(() =>
    can(currentUser.value, Capabilities.READ_AUDIT_LOGS, {
      scope: "team",
      teamRole: currentRole.value,
    })
  )

  const canManageBotSessions = computed(() =>
    can(currentUser.value, Capabilities.MANAGE_BOT_SESSIONS, {
      scope: "team",
      teamRole: currentRole.value,
    })
  )

  // Gates the Security settings tab (SSO, login methods, approved
  // domains). Owner/admin-only via the dedicated MANAGE_SECURITY
  // capability — strictly more sensitive than EDIT_TEAM.
  const canManageSecurity = computed(() =>
    can(currentUser.value, Capabilities.MANAGE_SECURITY, {
      scope: "team",
      teamRole: currentRole.value,
    })
  )

  // Gates the Storage settings tab's bulk archive/delete actions.
  // Workspace-scoped capability so the intent reads true even though the
  // resolver evaluates team and workspace scopes against the same role map.
  const canManageWorkspaceStorage = computed(() =>
    can(currentUser.value, Capabilities.MANAGE_WORKSPACE_STORAGE, {
      scope: "workspace",
      teamRole: currentRole.value,
    })
  )

  // "Member+ can view" gate for Tier-A settings pages (AI config, members,
  // workspaces, teams, plans, overview). True for owner/admin/member,
  // false for guests — controls page *visibility*, not mutation rights.
  const canViewTeamSettings = computed(() =>
    can(currentUser.value, Capabilities.VIEW_TEAM_SETTINGS, {
      scope: "team",
      teamRole: currentRole.value,
    })
  )

  return {
    currentRole,
    canViewLogs,
    canManageBotSessions,
    canManageSecurity,
    canManageWorkspaceStorage,
    canViewTeamSettings,
  }
}
