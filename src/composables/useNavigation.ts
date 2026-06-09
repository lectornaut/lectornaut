/**
 * Derived navigation views for Navigation.vue: the merged built-in + custom
 * agent roster the "edit" submenu renders (with team-membership dots and
 * built-in/custom glyphs) plus the drag-reorder wiring over the nav items.
 *
 * Canonical state stays in the stores — {@link useNavigationStore} owns the nav
 * items, {@link useUiPreferencesStore} owns agent visibility. This composable
 * reads them (and the team agent/member rosters), derives the roster metadata,
 * and re-exposes exactly what the view binds, so the component stays
 * presentation-only.
 */
import { isBuiltInAgentId } from "@/data/builtInAgents"
import { IconSparkle, IconSparkles } from "@/data/icons"
import { useMembershipStore } from "@/stores/membershipStore"
import { useNavigationStore } from "@/stores/navigationStore"
import { useTeamAgentsStore } from "@/stores/teamAgentsStore"
import { useUiPreferencesStore } from "@/stores/uiPreferencesStore"
import { isAgentMembership } from "@/types/membership"
import { useSortable } from "@vueuse/integrations/useSortable"
import { storeToRefs } from "pinia"
import { computed, type Ref } from "vue"
import { useI18n } from "vue-i18n"

/**
 * @param el Template ref for the sidebar menu list. Owned by the component (it
 *   is the `ref="el"` binding point); the drag-reorder wiring lives here.
 */
export function useNavigation(el: Ref<HTMLElement | undefined>) {
  const { t } = useI18n()

  const navigationStore = useNavigationStore()
  const { activeNavItems, isLoading } = storeToRefs(navigationStore)
  const { toggleNavItem, resetNavItems } = navigationStore

  const uiPreferencesStore = useUiPreferencesStore()
  const { agentsSidebarVisible } = storeToRefs(uiPreferencesStore)
  const { isAgentVisible, setAgentVisible } = uiPreferencesStore

  // Merged built-in + custom roster the Agents sidebar renders. Listed here
  // so each agent gets its own visibility checkbox in the submenu.
  const teamAgentsStore = useTeamAgentsStore()
  const { pickerAgents } = storeToRefs(teamAgentsStore)

  // Agents added as members of the active team get a corner dot in the
  // submenu. `teamMembers` is already scoped to the current team, so we just
  // narrow to the agent rows and key by agentId for an O(1) lookup.
  const membershipStore = useMembershipStore()
  const { teamMembers } = storeToRefs(membershipStore)
  const memberAgentIds = computed(
    () =>
      new Set(
        teamMembers.value
          .filter(isAgentMembership)
          .map((member) => member.agentId)
      )
  )

  // Agent-kind glyph + label. A single `sparkle` marks an admin-authored
  // custom agent; the plural `sparkles` marks a built-in preset. Keyed off
  // `isBuiltInAgentId`, which detects the `_`-prefixed built-in ids.
  const agentKindIcon = (agentId: string) =>
    isBuiltInAgentId(agentId) ? IconSparkles : IconSparkle
  const agentKindLabel = (agentId: string) =>
    isBuiltInAgentId(agentId)
      ? t("ai.agents.builtInTooltip")
      : t("ai.agents.customTooltip")

  // Drag-reorder the nav items in place via the component-owned `el`;
  // reordering mutates `activeNavItems`, which the store persists (debounced).
  useSortable(el, activeNavItems, {
    animation: 150,
    draggable: ".nav-item",
    ghostClass: "cursor-grab",
    chosenClass: "cursor-grabbing",
    dragClass: "cursor-grabbing",
  })

  return {
    isLoading,
    activeNavItems,
    toggleNavItem,
    resetNavItems,
    agentsSidebarVisible,
    isAgentVisible,
    setAgentVisible,
    pickerAgents,
    memberAgentIds,
    agentKindIcon,
    agentKindLabel,
  }
}
