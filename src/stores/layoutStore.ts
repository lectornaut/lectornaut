/**
 * Layout Store
 * ============
 *
 * Owns two independent slices of per-user layout state, each backed by its own
 * Firestore document and kept responsive with optimistic local updates:
 *
 *   1. Tabs — the open/active/recently-closed tab strip. Scoped to the active
 *      workspace at `teams/{team}/memberships/{uid}/workspaces/{ws}/layout/tabs`,
 *      so switching workspace swaps the whole strip.
 *
 *   2. Navigation + UI prefs — the sidebar nav order/visibility, the panel
 *      collapse flags, and per-agent visibility. Scoped to the user at
 *      `users/{uid}/layout/navigation`, so these follow the user across
 *      workspaces and devices.
 *
 * Writes are optimistic: local state changes immediately, the Firestore write
 * is queued through the sync engine, and a failure rolls the local state back.
 * Reads come through TanStack-backed `useDocumentQuery`, which surfaces three
 * states we depend on: `undefined` (loading), `null` (confirmed-absent), or the
 * parsed document. Snapshot-application is gated by pending-operation flags so
 * an in-flight optimistic edit is never clobbered by an interim server tick.
 */

import { defaultMenu } from "@/helpers/defaults"
import { generateId, isDefaultRoute } from "@/helpers/utilities"
import { firestore } from "@/modules/firebase"
import { useTeamStore } from "@/stores/teamStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import type {
  LayoutNavigationDoc,
  LayoutTab,
  LayoutTabIndicator,
  LayoutTabsDoc,
  NavigationUiState,
} from "@/types/layout"
import {
  cloneState,
  createDebouncedCloudSync,
  createPendingSet,
  withCloudSyncOperation,
  withOptimisticBatchUpdate,
  withOptimisticUpdate,
} from "@/utils/firebase/firebase-optimistic"
import { useDocumentQuery } from "@/utils/firebase/firebase-query"
import { safeSetDocument as safeSetDoc } from "@/utils/firebase/firebase-sync-engine"
import { useStorage, watchDebounced } from "@vueuse/core"
import { doc } from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"
import { useCurrentUser } from "vuefire"

export type Tab = LayoutTab
export type NavItem = (typeof defaultMenu)[number]

// Debounce for every "settled state → Firestore" watcher. Long enough to
// collapse a burst of edits into one write, short enough to feel instant.
const PERSIST_DEBOUNCE_MS = 500

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const asTabsDoc = (value: unknown): LayoutTabsDoc | null =>
  isRecord(value) ? (value as LayoutTabsDoc) : null

const asNavigationDoc = (value: unknown): LayoutNavigationDoc | null =>
  isRecord(value) ? (value as LayoutNavigationDoc) : null

// Coerce a tab's optional `pinned` to a strict boolean so downstream
// comparisons and the pinned/regular partition never trip over `undefined`.
const normalizeTab = (tab: Tab): Tab => ({
  ...tab,
  pinned: Boolean(tab.pinned),
})

/**
 * Stable partition that floats pinned tabs to the front while preserving the
 * relative order within each group. This is the canonical tab ordering — it
 * runs after every mutation and after a drag reorder so pinned tabs can never
 * end up interleaved with regular ones.
 */
const normalizeTabs = (value: Tab[]): Tab[] => {
  const pinned: Tab[] = []
  const regular: Tab[] = []
  for (const tab of value) {
    const next = normalizeTab(tab)
    ;(next.pinned ? pinned : regular).push(next)
  }
  return [...pinned, ...regular]
}

const normalizeTabHistory = (value: Tab[]): Tab[] => value.map(normalizeTab)

export const useLayoutStore = defineStore("layout", () => {
  const user = useCurrentUser()
  const { currentTeam } = storeToRefs(useTeamStore())
  const { currentWorkspace } = storeToRefs(useWorkspaceStore())

  // ==========================================================================
  // State
  // ==========================================================================

  // UI-prefs lane: each flag writes to localStorage instantly (optimistic,
  // offline-safe) and is mirrored into the per-user `navigation.ui` doc for
  // cross-device sync. Keys are stable contracts — never rename them.
  const sidebarOpen = useStorage<boolean>("layout.sidebar.open", true)
  // When pinned, MainSidebar collapses to an icon rail instead of sliding
  // offscreen. Same lane as `sidebarOpen`.
  const sidebarPinned = useStorage<boolean>("layout.sidebar.pinned", false)
  const leftPanelCollapsed = useStorage<boolean>(
    "layout.panel.left.collapsed",
    false
  )
  const rightPanelCollapsed = useStorage<boolean>(
    "layout.panel.right.collapsed",
    false
  )
  const bottomPanelCollapsed = useStorage<boolean>(
    "layout.panel.bottom.collapsed",
    false
  )
  // Visibility of the whole Agents section in the sidebar footer. Defaults
  // visible so existing users keep seeing it.
  const agentsSidebarVisible = useStorage<boolean>(
    "layout.sidebar.agents.visible",
    true
  )
  // Per-agent visibility map (agentId → shown). Opt-out semantics: a missing
  // key means visible, so newly-added agents appear without a migration.
  const agentVisibility = useStorage<Record<string, boolean>>(
    "layout.sidebar.agents.visibility",
    {}
  )

  // Tabs lane (Firestore-authoritative, hydrated per workspace).
  const tabs = ref<Tab[]>([])
  const activeTabId = ref("")
  const recentlyClosed = ref<Tab[]>([])
  const tabIndicators = ref<Record<string, LayoutTabIndicator>>({})

  // Navigation lane (Firestore-authoritative, hydrated per user).
  const activeNavItems = ref<NavItem[]>([])

  const isHydrated = ref(false)

  // Pending-operation tracking. While a tab id sits in `pendingTabIds`, inbound
  // snapshots for the tabs doc are ignored so the optimistic edit survives.
  const pendingTabIds = shallowRef(createPendingSet())
  const pendingNavigation = shallowRef(false)
  // Set while we copy a remote `navigation.ui` snapshot into the local refs, so
  // the "mark dirty" watcher can tell our own apply apart from a user toggle.
  const isApplyingNavigationUiSnapshot = shallowRef(false)
  // True once a UI pref changed locally and hasn't round-tripped to Firestore.
  // Gates snapshot application so a stale remote doc can't revert a fresh edit.
  const navigationUiDirty = ref(false)

  // ==========================================================================
  // Computed
  // ==========================================================================

  const activeTab = computed(() =>
    tabs.value.find((tab) => tab.id === activeTabId.value)
  )

  const isTabPending = computed(
    () => (id: string) => pendingTabIds.value.has(id)
  )

  const hasAnyTabPending = computed(() => pendingTabIds.value.size > 0)

  // ==========================================================================
  // UI-prefs snapshot helpers
  // ==========================================================================

  const getNavigationUiState = (): NavigationUiState => ({
    sidebarOpen: sidebarOpen.value,
    sidebarPinned: sidebarPinned.value,
    leftPanelCollapsed: leftPanelCollapsed.value,
    rightPanelCollapsed: rightPanelCollapsed.value,
    bottomPanelCollapsed: bottomPanelCollapsed.value,
    agentsSidebarVisible: agentsSidebarVisible.value,
  })

  // A remote `ui` snapshot is "in sync" only when every field is a boolean and
  // equals its local counterpart. Used to clear the dirty flag after our own
  // write lands.
  const isNavigationUiSnapshotInSync = (ui: Partial<NavigationUiState>) =>
    typeof ui.sidebarOpen === "boolean" &&
    ui.sidebarOpen === sidebarOpen.value &&
    typeof ui.sidebarPinned === "boolean" &&
    ui.sidebarPinned === sidebarPinned.value &&
    typeof ui.leftPanelCollapsed === "boolean" &&
    ui.leftPanelCollapsed === leftPanelCollapsed.value &&
    typeof ui.rightPanelCollapsed === "boolean" &&
    ui.rightPanelCollapsed === rightPanelCollapsed.value &&
    typeof ui.bottomPanelCollapsed === "boolean" &&
    ui.bottomPanelCollapsed === bottomPanelCollapsed.value &&
    typeof ui.agentsSidebarVisible === "boolean" &&
    ui.agentsSidebarVisible === agentsSidebarVisible.value

  // Opt-out lookup: only an explicit `false` hides an agent. Reading the ref
  // here keeps template/computed callers reactive.
  const isAgentVisible = (agentId: string): boolean =>
    agentVisibility.value[agentId] !== false

  // Subset check (local ⊆ saved): every locally-set key must match the saved
  // map. Deliberately ignores extra saved keys so a key set then dropped on
  // another device can't wedge the prefs permanently dirty.
  const isAgentVisibilityPersisted = (
    saved: Record<string, boolean>
  ): boolean =>
    Object.keys(agentVisibility.value).every(
      (id) => saved[id] === agentVisibility.value[id]
    )

  // Exact key/value equality — guards the snapshot-apply assignment so an
  // identical merge doesn't churn reactivity.
  const agentVisibilityEquals = (
    candidate: Record<string, boolean>
  ): boolean => {
    const local = agentVisibility.value
    const localKeys = Object.keys(local)
    const candidateKeys = Object.keys(candidate)
    if (localKeys.length !== candidateKeys.length) return false
    return candidateKeys.every((id) => local[id] === candidate[id])
  }

  // ==========================================================================
  // Firestore document refs
  // ==========================================================================

  const tabsDocRef = computed(() => {
    const uid = user.value?.uid
    const teamId = currentTeam.value?.id
    const workspaceId = currentWorkspace.value?.id
    if (!uid || !teamId || !workspaceId) return null
    return doc(
      firestore,
      "teams",
      teamId,
      "memberships",
      uid,
      "workspaces",
      workspaceId,
      "layout",
      "tabs"
    )
  })

  const navigationDocRef = computed(() => {
    const uid = user.value?.uid
    if (!uid) return null
    return doc(firestore, "users", uid, "layout", "navigation")
  })

  // ==========================================================================
  // Reads (TanStack Query, realtime)
  // ==========================================================================

  const { data: tabsDocData, isLoading: tabsPending } =
    useDocumentQuery(tabsDocRef)
  const { data: navDocData, isLoading: navPending } =
    useDocumentQuery(navigationDocRef)

  const isLoading = computed(
    () => (tabsPending.value || navPending.value) && !isHydrated.value
  )

  // ==========================================================================
  // Persistence helpers (function declarations: hoisted so the watchers and
  // the debounced sync below can reference them before this point in source).
  // ==========================================================================

  function persistTabs(): Promise<boolean> {
    return safeSetDoc(
      tabsDocRef.value,
      {
        tabs: tabs.value,
        active: activeTabId.value,
        recentlyClosed: recentlyClosed.value,
      },
      "layout.tabs.persist"
    )
  }

  function persistNavigationUiState(): Promise<boolean> {
    return safeSetDoc(
      navigationDocRef.value,
      {
        ui: getNavigationUiState(),
        agentVisibility: agentVisibility.value,
      },
      "layout.navigation.ui.persist"
    )
  }

  function persistNavigation(): Promise<boolean> {
    if (!navigationDocRef.value) return Promise.resolve(false)

    const order = activeNavItems.value.map((item) => item.id)
    const activeIds = new Set(order)
    const visibleItems: Record<string, boolean> = {}
    for (const item of defaultMenu) {
      visibleItems[item.id] = activeIds.has(item.id)
    }

    return safeSetDoc(
      navigationDocRef.value,
      { visibleItems, order },
      "layout.navigation.persist"
    )
  }

  // Tab-indicator maintenance (hoisted: referenced by the tabsDocData watch).
  function pruneTabIndicators(nextTabs: Tab[] = tabs.value) {
    const validIds = new Set(nextTabs.map((tab) => tab.id))
    tabIndicators.value = Object.fromEntries(
      Object.entries(tabIndicators.value).filter(([id]) => validIds.has(id))
    )
  }

  // Prepend a closed tab to the recently-closed history (hoisted: referenced by
  // the close actions). Collapses a duplicate of the current head and caps at 20.
  function addToHistory(tab: Tab) {
    const head = recentlyClosed.value[0]
    if (
      head?.fullPath === tab.fullPath &&
      head?.name === tab.name &&
      head?.pinned === Boolean(tab.pinned)
    ) {
      return
    }
    recentlyClosed.value = [
      {
        id: generateId(),
        name: tab.name,
        fullPath: tab.fullPath,
        pinned: Boolean(tab.pinned),
      },
      ...recentlyClosed.value,
    ].slice(0, 20)
  }

  // ==========================================================================
  // Debounced UI-prefs sync
  //
  // Declared BEFORE the `navDocData` watch on purpose: that watch is
  // `immediate` and reads synchronously from the persisted query cache, so its
  // first callback can run during store setup and reads `pendingNavigationUi`
  // (to skip applying remote state mid-write). The binding must exist by then.
  // ==========================================================================

  const { trigger: persistNavigationUiWithSync, pending: pendingNavigationUi } =
    createDebouncedCloudSync({
      persist: persistNavigationUiState,
      id: "navigation-ui",
      source: "layout.navigation.ui.persist",
      canPersist: () => navigationDocRef.value !== null,
      errorLabel: "layout.navigationUi",
    })

  // ==========================================================================
  // Hydration watchers (read → local state, guarded against optimistic clobber)
  // ==========================================================================

  // Tabs doc → local tab state.
  watch(
    tabsDocData,
    (snapshot) => {
      // An in-flight optimistic tab op owns the local state right now.
      if (pendingTabIds.value.size > 0) return
      // No valid ref yet (user/team/workspace not resolved) — nothing to apply.
      if (!tabsDocRef.value) return
      // `undefined` is the loading window; only `null` means confirmed-absent.
      if (snapshot === undefined) return

      if (!snapshot) {
        // Confirmed empty: a workspace with no saved tabs. Reset everything.
        tabs.value = []
        activeTabId.value = ""
        recentlyClosed.value = []
        tabIndicators.value = {}
        return
      }

      const tabsDoc = asTabsDoc(snapshot)
      tabs.value = normalizeTabs(tabsDoc?.tabs ?? [])
      activeTabId.value = tabsDoc?.active ?? ""
      recentlyClosed.value = normalizeTabHistory(tabsDoc?.recentlyClosed ?? [])
      pruneTabIndicators(tabs.value)
    },
    { immediate: true }
  )

  // Team/workspace change → pause sync and clear local tabs until the new
  // workspace's snapshot lands. The `oldId !== undefined` guard skips the
  // initial resolution (when both go from undefined to a value).
  watch(
    [() => currentTeam.value?.id, () => currentWorkspace.value?.id],
    ([newTeamId, newWorkspaceId], [oldTeamId, oldWorkspaceId]) => {
      const teamChanged = newTeamId !== oldTeamId && oldTeamId !== undefined
      const workspaceChanged =
        newWorkspaceId !== oldWorkspaceId && oldWorkspaceId !== undefined
      if (!teamChanged && !workspaceChanged) return

      isHydrated.value = false
      tabs.value = []
      activeTabId.value = ""
      recentlyClosed.value = []
      tabIndicators.value = {}
    }
  )

  // Local UI-pref change → mark dirty. `flush: "sync"` so the flag is set before
  // any subsequent snapshot watcher can run. `agentVisibility` is reassigned
  // wholesale on every toggle, so top-level reactivity catches it without `deep`.
  watch(
    [
      sidebarOpen,
      sidebarPinned,
      leftPanelCollapsed,
      rightPanelCollapsed,
      bottomPanelCollapsed,
      agentsSidebarVisible,
      agentVisibility,
    ],
    () => {
      if (isApplyingNavigationUiSnapshot.value) return
      navigationUiDirty.value = true
    },
    { flush: "sync" }
  )

  // Navigation doc → UI prefs + nav items.
  watch(
    navDocData,
    (snapshot) => {
      // Loading window — don't flash defaults before the real doc arrives.
      if (snapshot === undefined) return

      const navigationDoc = asNavigationDoc(snapshot)
      if (!navigationDoc) {
        // Confirmed-absent (or non-object) doc: fall back to the default menu,
        // but only when we aren't mid-write and aren't still loading.
        if (!pendingNavigation.value && !navPending.value) {
          activeNavItems.value = [...defaultMenu]
        }
        return
      }

      const ui = isRecord(navigationDoc.ui) ? navigationDoc.ui : null
      const savedAgentVisibility = isRecord(navigationDoc.agentVisibility)
        ? (navigationDoc.agentVisibility as Record<string, boolean>)
        : null

      // Clear the dirty flag once our own write round-trips. Each field present
      // in the snapshot must match local; an absent field is not gating, so an
      // older doc that predates either feature won't keep prefs stuck dirty.
      if (
        navigationUiDirty.value &&
        (ui || savedAgentVisibility) &&
        (!ui || isNavigationUiSnapshotInSync(ui)) &&
        (!savedAgentVisibility ||
          isAgentVisibilityPersisted(savedAgentVisibility))
      ) {
        navigationUiDirty.value = false
      }

      // Apply the remote UI snapshot only when nothing local is pending/dirty.
      if (
        (ui || savedAgentVisibility) &&
        !pendingNavigationUi.value &&
        !navigationUiDirty.value
      ) {
        isApplyingNavigationUiSnapshot.value = true
        try {
          if (ui) {
            if (
              typeof ui.sidebarOpen === "boolean" &&
              ui.sidebarOpen !== sidebarOpen.value
            ) {
              sidebarOpen.value = ui.sidebarOpen
            }
            if (
              typeof ui.sidebarPinned === "boolean" &&
              ui.sidebarPinned !== sidebarPinned.value
            ) {
              sidebarPinned.value = ui.sidebarPinned
            }
            if (
              typeof ui.leftPanelCollapsed === "boolean" &&
              ui.leftPanelCollapsed !== leftPanelCollapsed.value
            ) {
              leftPanelCollapsed.value = ui.leftPanelCollapsed
            }
            if (
              typeof ui.rightPanelCollapsed === "boolean" &&
              ui.rightPanelCollapsed !== rightPanelCollapsed.value
            ) {
              rightPanelCollapsed.value = ui.rightPanelCollapsed
            }
            if (
              typeof ui.bottomPanelCollapsed === "boolean" &&
              ui.bottomPanelCollapsed !== bottomPanelCollapsed.value
            ) {
              bottomPanelCollapsed.value = ui.bottomPanelCollapsed
            }
            if (
              typeof ui.agentsSidebarVisible === "boolean" &&
              ui.agentsSidebarVisible !== agentsSidebarVisible.value
            ) {
              agentsSidebarVisible.value = ui.agentsSidebarVisible
            }
          }
          if (savedAgentVisibility) {
            // Merge remote over local (not replace) so a key just set on this
            // device isn't dropped by an older snapshot. Guarded by the
            // applying flag so it can't re-mark prefs dirty.
            const merged = { ...agentVisibility.value, ...savedAgentVisibility }
            if (!agentVisibilityEquals(merged)) {
              agentVisibility.value = merged
            }
          }
        } finally {
          isApplyingNavigationUiSnapshot.value = false
        }
      }

      // A nav-items mutation owns `activeNavItems` right now.
      if (pendingNavigation.value) return

      // Reconcile `activeNavItems` from the saved order + visibility:
      //   - opt-out visibility (only an explicit `false` hides an item),
      //   - saved order first (for known + visible ids),
      //   - then any remaining visible items in default-menu order.
      const savedVisibility = navigationDoc.visibleItems ?? {}
      const savedOrder = (navigationDoc.order ?? []).filter(
        (value): value is string => typeof value === "string"
      )

      const visibleIds = new Set<string>()
      for (const item of defaultMenu) {
        if (savedVisibility[item.id] !== false) visibleIds.add(item.id)
      }

      const nextActiveItems: NavItem[] = []
      const processedIds = new Set<string>()
      for (const id of savedOrder) {
        const item = defaultMenu.find((entry) => entry.id === id)
        if (item && visibleIds.has(id)) {
          nextActiveItems.push(item)
          processedIds.add(id)
        }
      }
      for (const item of defaultMenu) {
        if (visibleIds.has(item.id) && !processedIds.has(item.id)) {
          nextActiveItems.push(item)
        }
      }

      activeNavItems.value = nextActiveItems
    },
    { immediate: true }
  )

  // Hydration gate: hydrated only once we have a valid tabs ref AND no layout
  // doc is still pending. Re-enters hydration mode while anything refreshes.
  watch(
    [tabsPending, navPending, tabsDocRef],
    ([tp, np, tabsRef]) => {
      if (!tabsRef || tp || np) {
        isHydrated.value = false
        return
      }
      isHydrated.value = true
    },
    { immediate: true }
  )

  // ==========================================================================
  // Persistence watchers (debounced: settled local state → Firestore)
  // ==========================================================================

  // Tabs. No `deep` — every mutation reassigns the array or replaces tab
  // objects, so top-level reactivity is enough (and a deep walk would fire on
  // every route navigation via `updateActiveTab`).
  watchDebounced(
    [tabs, activeTabId, recentlyClosed],
    () => {
      if (pendingTabIds.value.size > 0) return
      if (!tabsDocRef.value || tabsPending.value || !isHydrated.value) return
      void persistTabs()
    },
    { debounce: PERSIST_DEBOUNCE_MS }
  )

  // Nav items. No `deep` — every mutation reassigns `activeNavItems`.
  watchDebounced(
    activeNavItems,
    () => {
      if (pendingNavigation.value) return
      void persistNavigation()
    },
    { debounce: PERSIST_DEBOUNCE_MS }
  )

  // UI prefs. Only persists when a local change actually marked things dirty.
  watchDebounced(
    [
      sidebarOpen,
      sidebarPinned,
      leftPanelCollapsed,
      rightPanelCollapsed,
      bottomPanelCollapsed,
      agentsSidebarVisible,
      agentVisibility,
    ],
    () => {
      if (!navigationUiDirty.value) return
      void persistNavigationUiWithSync()
    },
    { debounce: PERSIST_DEBOUNCE_MS }
  )

  // ==========================================================================
  // Tab actions (optimistic)
  // ==========================================================================

  function createTab(
    fullPath: string,
    name?: string,
    options?: { pinned?: boolean }
  ): Tab {
    // Truthy fallback (matches the original): an empty-string name — which can
    // arrive via an external `Tabs.Add` mitt payload — still becomes "New tab".
    return {
      id: generateId(),
      name: name || "New tab",
      fullPath,
      pinned: Boolean(options?.pinned),
    }
  }

  function normalizeTabOrder() {
    tabs.value = normalizeTabs(tabs.value)
  }

  function setTabIndicator(id: string, indicator: LayoutTabIndicator) {
    if (!tabs.value.some((tab) => tab.id === id)) return
    tabIndicators.value = { ...tabIndicators.value, [id]: indicator }
  }

  function clearTabIndicator(id: string) {
    if (!tabIndicators.value[id]) return
    const next = { ...tabIndicators.value }
    delete next[id]
    tabIndicators.value = next
  }

  function getTabIndicator(id: string) {
    return tabIndicators.value[id] ?? null
  }

  async function addTab(
    fullPath = "/new",
    name = "New tab",
    options?: { pinned?: boolean }
  ): Promise<Tab> {
    const newTab = createTab(fullPath, name, options)
    const previousTabs = cloneState(tabs.value)
    const previousActiveTabId = activeTabId.value

    await withOptimisticUpdate(
      pendingTabIds,
      newTab.id,
      () => {
        tabs.value = normalizeTabs([...tabs.value, newTab])
        activeTabId.value = newTab.id
      },
      () => {
        tabs.value = previousTabs
        activeTabId.value = previousActiveTabId
      },
      async () => {
        if (!(await persistTabs())) throw new Error("Failed to persist tab")
      }
    )

    return newTab
  }

  async function closeTab(id: string): Promise<{ nextPath: string } | null> {
    const idx = tabs.value.findIndex((tab) => tab.id === id)
    if (idx === -1) return null

    const closing = tabs.value[idx]
    if (!closing || closing.pinned) return null

    const previousTabs = cloneState(tabs.value)
    const previousActiveTabId = activeTabId.value
    const previousRecentlyClosed = cloneState(recentlyClosed.value)
    const previousTabIndicators = cloneState(tabIndicators.value)

    let nextPath: string | null = null

    await withOptimisticUpdate(
      pendingTabIds,
      id,
      () => {
        addToHistory(closing)

        const newTabs = [...tabs.value]
        newTabs.splice(idx, 1)

        let nextId = activeTabId.value
        if (newTabs.length === 0) {
          nextId = ""
          nextPath = "/start"
        } else if (closing.id === activeTabId.value) {
          // After splicing index `idx`, the tab now at `idx` is the one that
          // followed the closed tab; fall back to its predecessor.
          const nextTab = newTabs[idx] || newTabs[idx - 1]
          if (nextTab) {
            nextId = nextTab.id
            nextPath = nextTab.fullPath
          }
        }

        tabs.value = normalizeTabs(newTabs)
        activeTabId.value = nextId
        pruneTabIndicators(newTabs)
      },
      () => {
        tabs.value = previousTabs
        activeTabId.value = previousActiveTabId
        recentlyClosed.value = previousRecentlyClosed
        tabIndicators.value = previousTabIndicators
      },
      async () => {
        if (!(await persistTabs())) {
          throw new Error("Failed to persist tab close")
        }
      }
    )

    return nextPath ? { nextPath } : null
  }

  async function closeOtherTabs(keepId: string): Promise<void> {
    const keep = tabs.value.find((tab) => tab.id === keepId)
    if (!keep) return

    const tabsToClose = tabs.value.filter(
      (tab) => !tab.pinned && tab.id !== keepId
    )
    if (tabsToClose.length === 0) {
      activeTabId.value = keep.id
      return
    }

    const previousTabs = cloneState(tabs.value)
    const previousActiveTabId = activeTabId.value
    const previousRecentlyClosed = cloneState(recentlyClosed.value)
    const previousTabIndicators = cloneState(tabIndicators.value)

    await withOptimisticBatchUpdate(
      pendingTabIds,
      tabsToClose.map((tab) => tab.id),
      () => {
        tabsToClose.forEach(addToHistory)
        const remaining = normalizeTabs(
          tabs.value.filter((tab) => tab.pinned || tab.id === keepId)
        )
        tabs.value = remaining
        activeTabId.value = keep.id
        pruneTabIndicators(remaining)
      },
      () => {
        tabs.value = previousTabs
        activeTabId.value = previousActiveTabId
        recentlyClosed.value = previousRecentlyClosed
        tabIndicators.value = previousTabIndicators
      },
      async () => {
        if (!(await persistTabs())) {
          throw new Error("Failed to persist closeOtherTabs")
        }
      },
      { source: "layout.tabs.closeOther" }
    )
  }

  async function closeAllTabs(): Promise<void> {
    const tabsToClose = tabs.value.filter((tab) => !tab.pinned)
    if (tabsToClose.length === 0) return

    const previousTabs = cloneState(tabs.value)
    const previousActiveTabId = activeTabId.value
    const previousRecentlyClosed = cloneState(recentlyClosed.value)
    const previousTabIndicators = cloneState(tabIndicators.value)

    await withOptimisticBatchUpdate(
      pendingTabIds,
      tabsToClose.map((tab) => tab.id),
      () => {
        tabsToClose.forEach(addToHistory)
        const remaining = normalizeTabs(tabs.value.filter((tab) => tab.pinned))
        const stillActive = remaining.find(
          (tab) => tab.id === activeTabId.value
        )
        tabs.value = remaining
        activeTabId.value = stillActive?.id ?? remaining[0]?.id ?? ""
        pruneTabIndicators(remaining)
      },
      () => {
        tabs.value = previousTabs
        activeTabId.value = previousActiveTabId
        recentlyClosed.value = previousRecentlyClosed
        tabIndicators.value = previousTabIndicators
      },
      async () => {
        if (!(await persistTabs())) {
          throw new Error("Failed to persist closeAllTabs")
        }
      },
      { source: "layout.tabs.closeAll" }
    )
  }

  function clearRecentlyClosed() {
    recentlyClosed.value = []
  }

  function reopenLastClosed(): Tab | null {
    if (recentlyClosed.value.length === 0) return null
    const [last, ...rest] = recentlyClosed.value
    if (!last) return null
    recentlyClosed.value = rest
    return last
  }

  async function duplicateTab(id: string): Promise<void> {
    const tab = tabs.value.find((entry) => entry.id === id)
    if (!tab || isDefaultRoute(tab)) return

    const duplicate = createTab(
      tab.fullPath,
      tab.name.endsWith(" (Copy)") ? tab.name : `${tab.name} (Copy)`,
      { pinned: false }
    )

    const previousTabs = cloneState(tabs.value)
    const previousActiveTabId = activeTabId.value

    await withOptimisticUpdate(
      pendingTabIds,
      duplicate.id,
      () => {
        tabs.value = normalizeTabs([...tabs.value, duplicate])
        activeTabId.value = duplicate.id
      },
      () => {
        tabs.value = previousTabs
        activeTabId.value = previousActiveTabId
      },
      async () => {
        if (!(await persistTabs())) {
          throw new Error("Failed to persist duplicateTab")
        }
      }
    )
  }

  async function renameTab(id: string, newName: string): Promise<void> {
    const tab = tabs.value.find((entry) => entry.id === id)
    if (!tab || isDefaultRoute(tab)) return
    const trimmed = newName.trim()
    if (!trimmed) return

    const previousTabs = cloneState(tabs.value)

    await withOptimisticUpdate(
      pendingTabIds,
      id,
      () => {
        tabs.value = tabs.value.map((entry) =>
          entry.id === id ? { ...entry, name: trimmed } : entry
        )
      },
      () => {
        tabs.value = previousTabs
      },
      async () => {
        if (!(await persistTabs())) {
          throw new Error("Failed to persist renameTab")
        }
      }
    )
  }

  async function setTabPinned(id: string, pinned: boolean): Promise<void> {
    const tab = tabs.value.find((entry) => entry.id === id)
    if (!tab || tab.pinned === pinned) return

    const previousTabs = cloneState(tabs.value)

    await withOptimisticUpdate(
      pendingTabIds,
      id,
      () => {
        tabs.value = normalizeTabs(
          tabs.value.map((entry) =>
            entry.id === id ? { ...entry, pinned } : entry
          )
        )
      },
      () => {
        tabs.value = previousTabs
      },
      async () => {
        if (!(await persistTabs())) {
          throw new Error("Failed to persist setTabPinned")
        }
      }
    )
  }

  function setActiveTab(id: string) {
    activeTabId.value = id
  }

  // Point the active tab at a new path (and optionally rename it) without
  // creating a tab — used by the router→store sync to "consume" the active tab.
  function updateActiveTab(fullPath: string, name?: string) {
    if (!activeTabId.value) return
    const idx = tabs.value.findIndex((tab) => tab.id === activeTabId.value)
    if (idx === -1) return
    tabs.value = tabs.value.map((tab, i) =>
      i === idx ? { ...tab, fullPath, ...(name ? { name } : {}) } : tab
    )
  }

  // ==========================================================================
  // Navigation actions (optimistic, single-flight via pendingNavigation)
  // ==========================================================================

  async function mutateNavigationItems(options: {
    id: string
    source: string
    actionName: string
    applyOptimistic: () => void
  }): Promise<void> {
    const previousNavItems = cloneState(activeNavItems.value)
    pendingNavigation.value = true

    try {
      options.applyOptimistic()
      await withCloudSyncOperation(
        async () => {
          if (!(await persistNavigation())) {
            throw new Error(`Failed to persist ${options.actionName}`)
          }
        },
        { id: options.id, source: options.source }
      )
    } catch (error) {
      activeNavItems.value = previousNavItems
      console.error(`[layoutStore] ${options.actionName} failed:`, error)
      throw error
    } finally {
      pendingNavigation.value = false
    }
  }

  async function toggleNavItem(
    itemId: string,
    checked: boolean
  ): Promise<void> {
    await mutateNavigationItems({
      id: itemId,
      source: "layout.navigation.toggle",
      actionName: "toggleNavItem",
      applyOptimistic: () => {
        if (checked) {
          const item = defaultMenu.find((entry) => entry.id === itemId)
          if (item && !activeNavItems.value.some((i) => i.id === itemId)) {
            activeNavItems.value = [...activeNavItems.value, item]
          }
          return
        }
        activeNavItems.value = activeNavItems.value.filter(
          (item) => item.id !== itemId
        )
      },
    })
  }

  async function setNavItems(items: NavItem[]): Promise<void> {
    await mutateNavigationItems({
      id: "set",
      source: "layout.navigation.set",
      actionName: "setNavItems",
      applyOptimistic: () => {
        activeNavItems.value = cloneState(items)
      },
    })
  }

  // Toggle a single agent's visibility. Writes an explicit boolean (never
  // deletes the key) so re-showing an agent overrides a remote `false` under
  // Firestore merge semantics. Persistence rides the debounced UI-prefs watcher.
  function setAgentVisible(agentId: string, visible: boolean): void {
    if (isAgentVisible(agentId) === visible) return
    agentVisibility.value = { ...agentVisibility.value, [agentId]: visible }
  }

  async function resetNavItems(): Promise<void> {
    await mutateNavigationItems({
      id: "reset",
      source: "layout.navigation.reset",
      actionName: "resetNavItems",
      applyOptimistic: () => {
        activeNavItems.value = [...defaultMenu]
      },
    })
  }

  return {
    // State
    tabs,
    activeTabId,
    activeTab,
    recentlyClosed,
    tabIndicators,
    activeNavItems,
    sidebarOpen,
    sidebarPinned,
    leftPanelCollapsed,
    rightPanelCollapsed,
    bottomPanelCollapsed,
    agentsSidebarVisible,
    agentVisibility,
    isLoading,
    isHydrated,

    // Pending state
    pendingTabIds,
    pendingNavigation,
    isTabPending,
    hasAnyTabPending,

    // Actions
    addTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    duplicateTab,
    renameTab,
    setTabPinned,
    setTabIndicator,
    clearTabIndicator,
    getTabIndicator,
    setActiveTab,
    updateActiveTab,
    toggleNavItem,
    setNavItems,
    resetNavItems,
    isAgentVisible,
    setAgentVisible,
    addToHistory,
    clearRecentlyClosed,
    reopenLastClosed,
    normalizeTabOrder,
  }
})
