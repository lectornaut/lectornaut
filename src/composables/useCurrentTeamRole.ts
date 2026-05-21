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

  return {
    currentRole,
    canViewLogs,
    canManageBotSessions,
  }
}
