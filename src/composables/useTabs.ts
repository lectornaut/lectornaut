/**
 * Derived views over {@link useTabsStore} for the tab strip (Tabbar.vue): the
 * pinned/closable/renamable guards the menus and tooltips gate on, the merged
 * tab indicator (stored badge ⊕ the "syncing" pending badge), and the
 * drag-reorder boundary math that keeps pinned tabs grouped at the front.
 *
 * The store stays the single source of truth — this composable only reads it
 * (plus i18n for the syncing label). The `useSortable` wiring itself stays in
 * the component because it binds the component-local `el` ref (shared with the
 * inline-rename focus logic); only the pure boundary predicate lives here.
 */
import { isDefaultRoute } from "@/helpers/utilities"
import { useTabsStore } from "@/stores/tabsStore"
import { storeToRefs } from "pinia"
import type Sortable from "sortablejs"
import { computed } from "vue"
import { useI18n } from "vue-i18n"

export function useTabs() {
  const { t } = useI18n()
  const tabsStore = useTabsStore()
  const { tabs, activeTab } = storeToRefs(tabsStore)
  const { getTabIndicator, isTabPending } = tabsStore

  const pinnedTabCount = computed(
    () => tabs.value.filter((tab) => tab.pinned).length
  )

  // ----------------------------------------------------------------------------
  // Menu/tooltip guards
  // ----------------------------------------------------------------------------
  const hasClosableTabs = computed(() => tabs.value.some((tab) => !tab.pinned))
  const canCloseActiveTab = computed(() =>
    Boolean(activeTab.value && !activeTab.value.pinned)
  )
  const canRenameActiveTab = computed(() =>
    Boolean(activeTab.value && !isDefaultRoute(activeTab.value))
  )

  function hasClosableOtherTabs(keepId?: string) {
    return tabs.value.some((tab) => !tab.pinned && tab.id !== keepId)
  }

  // Prefer an explicit stored indicator; otherwise show a syncing badge while a
  // tab op is in flight for this tab.
  function resolveTabIndicator(tab: { id: string }) {
    const stored = getTabIndicator(tab.id)
    if (stored) return stored
    if (isTabPending(tab.id)) {
      return { label: t("states.syncing"), tone: "info" as const, spin: true }
    }
    return null
  }

  // ----------------------------------------------------------------------------
  // Drag-and-drop reordering (pinned tabs stay grouped at the front)
  // ----------------------------------------------------------------------------
  function resolveDropIndex(evt: Sortable.MoveEvent) {
    const siblingTabs = Array.from(evt.to.children)
    const relatedIndex = siblingTabs.indexOf(evt.related)
    if (relatedIndex === -1) return siblingTabs.length
    return evt.willInsertAfter ? relatedIndex + 1 : relatedIndex
  }

  function isPinnedTabElement(element?: Element | null) {
    return element instanceof HTMLElement && element.dataset.pinned === "true"
  }

  // A pinned tab may only drop within the pinned prefix; a regular tab only
  // after it. Enforced mid-drag so the strip never interleaves the two groups.
  function canDropWithinTabBoundary(evt: Sortable.MoveEvent) {
    const dropIndex = resolveDropIndex(evt)
    return isPinnedTabElement(evt.dragged)
      ? dropIndex <= pinnedTabCount.value
      : dropIndex >= pinnedTabCount.value
  }

  return {
    pinnedTabCount,
    hasClosableTabs,
    canCloseActiveTab,
    canRenameActiveTab,
    hasClosableOtherTabs,
    resolveTabIndicator,
    resolveDropIndex,
    canDropWithinTabBoundary,
    isPinnedTabElement,
  }
}
