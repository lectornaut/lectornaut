/**
 * Derived navigation views for Navigation.vue: the merged built-in + custom
 * agent roster the "edit" dialog renders (with team-membership dots and
 * built-in/custom glyphs), the draggable nav-item roster that dialog edits,
 * plus the drag-reorder wiring over the live sidebar nav items.
 *
 * Canonical state stays in the stores — {@link useNavigationStore} owns the nav
 * items, {@link useUiPreferencesStore} owns agent visibility. This composable
 * reads them (and the team agent/member rosters), derives the roster metadata,
 * and re-exposes exactly what the view binds, so the component stays
 * presentation-only.
 */
import { isBuiltInAgentId } from "@/data/builtInAgents"
import { IconSparkle, IconSparkles } from "@/data/icons"
import { defaultMenu } from "@/helpers/defaults"
import { useMembershipStore } from "@/stores/membershipStore"
import { useNavigationStore, type NavItem } from "@/stores/navigationStore"
import { useTeamAgentsStore } from "@/stores/teamAgentsStore"
import { useUiPreferencesStore } from "@/stores/uiPreferencesStore"
import { isAgentMembership } from "@/types/membership"
import { useSortable } from "@vueuse/integrations/useSortable"
import { storeToRefs } from "pinia"
import { computed, nextTick, ref, watch, type Ref } from "vue"
import { useI18n } from "vue-i18n"

/**
 * @param el Template ref for the live sidebar menu list. Owned by the component
 *   (the `ref="el"` binding point); its drag-reorder wiring lives here.
 * @param rosterListEl Template ref for the edit dialog's roster list. Owned by
 *   the component (the `ref="rosterListEl"` binding point); the dialog's
 *   drag-reorder wiring lives here.
 */
export function useNavigation(
  el: Ref<HTMLElement | undefined>,
  rosterListEl: Ref<HTMLElement | undefined>
) {
  const { t } = useI18n()

  const navigationStore = useNavigationStore()
  const { activeNavItems, isLoading } = storeToRefs(navigationStore)
  const {
    toggleNavItem,
    resetNavItems: resetNavItemsStore,
    setNavItems,
  } = navigationStore

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

  // Generative-avatar seed, mirroring the Agents sidebar: explicit `avatarSeed`,
  // else the name, else the id — so the blob stays deterministic from the label.
  const agentAvatarSeed = (agent: {
    avatarSeed: string
    name: string
    id: string
  }) => agent.avatarSeed.trim() || agent.name.trim() || agent.id

  // Drag-reorder the nav items in place via the component-owned `el`;
  // reordering mutates `activeNavItems`, which the store persists (debounced).
  useSortable(el, activeNavItems, {
    animation: 150,
    draggable: ".nav-item",
    ghostClass: "cursor-grab",
    chosenClass: "cursor-grabbing",
    dragClass: "cursor-grabbing",
  })

  // ── Edit dialog ───────────────────────────────────────────────────────────
  // The dialog shows one unified, draggable roster: active items first (in
  // their saved order) then the rest, so a single list covers both ordering
  // (drag) and visibility (checkbox). Rebuilt each open so it starts from the
  // persisted state.
  const editOpen = ref(false)
  const rosterItems = ref<NavItem[]>([])

  const isItemActive = (id: string) =>
    activeNavItems.value.some((item) => item.id === id)

  function buildRoster() {
    const activeIds = new Set(activeNavItems.value.map((item) => item.id))
    rosterItems.value = [
      ...activeNavItems.value,
      ...defaultMenu.filter((item) => !activeIds.has(item.id)),
    ]
  }

  watch(editOpen, (open) => {
    if (open) buildRoster()
  })

  // Reset restores the default menu (store) AND rebuilds the dialog roster, so
  // its drag order + checkboxes reflect the reset immediately rather than
  // keeping the snapshot taken when the dialog opened.
  async function resetNavItems() {
    await resetNavItemsStore()
    buildRoster()
  }

  // Persist the active subset in current roster order after a drag. Visibility
  // toggles go through `toggleNavItem`; re-enabling an item appends it (store
  // behaviour), and the next drag reconciles it to its roster slot.
  // ponytail: re-add lands at the end until the next reorder — acceptable.
  const persistRosterOrder = () =>
    void setNavItems(rosterItems.value.filter((item) => isItemActive(item.id)))

  useSortable(rosterListEl, rosterItems, {
    animation: 150,
    handle: ".nav-drag-handle",
    // The dialog content is unmounted while closed, so `rosterListEl` is empty
    // at mount time. `watchElement` makes useSortable (re)attach SortableJS
    // each time the list appears instead of only once on mount (which no-ops).
    watchElement: true,
    // useSortable defers its array reassignment to nextTick (its `onUpdate`
    // runs before this `onEnd`), so read the reordered roster one tick later —
    // the FIFO microtask queue guarantees the reorder lands first.
    onEnd: () => void nextTick(persistRosterOrder),
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
    agentAvatarSeed,
    editOpen,
    rosterItems,
    isItemActive,
  }
}
