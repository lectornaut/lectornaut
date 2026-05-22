import { useCurrentTeamRole } from "@/composables/useCurrentTeamRole"
import { useAuthStore } from "@/stores/authStore"
import { storeToRefs } from "pinia"

/**
 * Convenience wrapper around `useCurrentTeamRole` bound to the *currently
 * selected* team. Tier-A settings pages (AI, Tools, Agents, Plans,
 * Overview, Workspaces, Members, Teams) use this to decide whether to
 * render their content or a permission wall — owner/admin/member can
 * view, guests cannot.
 *
 * Kept separate from `useCurrentTeamRole` (which takes an explicit teamId
 * so callers can check role for *any* team) so the common "gate the page
 * I'm on" case is a single zero-argument call without repeating the
 * authStore → currentTeamId plumbing in every component.
 */
export function useCanViewTeamSettings() {
  const { currentTeamId } = storeToRefs(useAuthStore())
  const { canViewTeamSettings } = useCurrentTeamRole(currentTeamId)
  return { canViewTeamSettings }
}
