/**
 * Layout Store with Optimistic Firestore Updates
 *
 * Manages tabs and layout navigation with:
 * - Instant UI updates via optimistic state changes
 * - Automatic rollback on Firestore errors
 * - pendingIds tracking to prevent snapshot overwrites
 * - Debounced persistence to Firestore
 */

import { defaultMenu } from "@/helpers/defaults"
import { generateId, isDefaultRoute } from "@/helpers/utilities"
import { useTeamStore } from "@/stores/teamStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import type {
  IconDisplay,
  LayoutNavigationDoc,
  LayoutTab,
  LayoutTabIndicator,
  LayoutTabsDoc,
  NavigationUiState,
} from "@/types/layout"
import {
  addPending,
  cloneState,
  createPendingSet,
  removePending,
  withCloudSyncOperation,
  withOptimisticUpdate,
} from "@/utils/firebase/firebase-optimistic"
import { mutateSetDocument } from "@/utils/firebase/firebase-sync-engine"
import { useStorage, watchDebounced } from "@vueuse/core"
import { collection, doc } from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"
import { useCurrentUser, useDocument, useFirestore } from "vuefire"

export type Tab = LayoutTab
export type NavItem = (typeof defaultMenu)[number]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isIconDisplay = (value: unknown): value is IconDisplay =>
  value === "icon" || value === "text"

const toLayoutTabsDoc = (value: unknown): LayoutTabsDoc | null =>
  isRecord(value) ? (value as LayoutTabsDoc) : null

const toLayoutNavigationDoc = (value: unknown): LayoutNavigationDoc | null =>
  isRecord(value) ? (value as LayoutNavigationDoc) : null

const normalizeTab = (tab: Tab): Tab => ({
  ...tab,
  pinned: Boolean(tab.pinned),
})

const normalizeTabs = (value: Tab[]): Tab[] => {
  const pinnedTabs: Tab[] = []
  const regularTabs: Tab[] = []

  for (const tab of value) {
    const normalizedTab = normalizeTab(tab)
    if (normalizedTab.pinned) {
      pinnedTabs.push(normalizedTab)
      continue
    }

    regularTabs.push(normalizedTab)
  }

  return [...pinnedTabs, ...regularTabs]
}

const normalizeTabHistory = (value: Tab[]): Tab[] => value.map(normalizeTab)

export const useLayoutStore = defineStore("layout", () => {
  const db = useFirestore()
  const user = useCurrentUser()
  const teamStore = useTeamStore()
  const { currentTeam } = storeToRefs(teamStore)
  const workspaceStore = useWorkspaceStore()
  const { currentWorkspace } = storeToRefs(workspaceStore)

  // ============================================================================
  // State
  // ============================================================================

  const headerIconDisplay = useStorage<IconDisplay>(
    "layout.header.iconDisplay",
    "icon"
  )
  const footerIconDisplay = useStorage<IconDisplay>(
    "layout.footer.iconDisplay",
    "icon"
  )
  const sidebarOpen = useStorage<boolean>("layout.sidebar.open", true)
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

  const tabs = ref<Tab[]>([])
  const activeTabId = ref("")
  const recentlyClosed = ref<Tab[]>([])
  const tabIndicators = ref<Record<string, LayoutTabIndicator>>({})
  const activeNavItems = ref<NavItem[]>([])
  const isHydrated = ref(false)

  // Pending operation tracking
  const pendingTabIds = shallowRef(createPendingSet())
  const pendingNavigation = shallowRef(false)
  const pendingNavigationUi = shallowRef(false)
  const isNavigationUiPersistQueued = ref(false)
  const isApplyingNavigationUiSnapshot = shallowRef(false)
  const navigationUiDirty = ref(false)

  // ============================================================================
  // Computed
  // ============================================================================

  const activeTab = computed(() =>
    tabs.value.find((t) => t.id === activeTabId.value)
  )

  /** Check if a specific tab has a pending operation */
  const isTabPending = computed(
    () => (id: string) => pendingTabIds.value.has(id)
  )

  /** Check if any tab operation is pending */
  const hasAnyTabPending = computed(() => pendingTabIds.value.size > 0)

  const getNavigationUiState = (): NavigationUiState => ({
    headerIconDisplay: headerIconDisplay.value,
    footerIconDisplay: footerIconDisplay.value,
    sidebarOpen: sidebarOpen.value,
    leftPanelCollapsed: leftPanelCollapsed.value,
    rightPanelCollapsed: rightPanelCollapsed.value,
    bottomPanelCollapsed: bottomPanelCollapsed.value,
  })

  const isNavigationUiSnapshotInSync = (ui: Partial<NavigationUiState>) =>
    isIconDisplay(ui.headerIconDisplay) &&
    ui.headerIconDisplay === headerIconDisplay.value &&
    isIconDisplay(ui.footerIconDisplay) &&
    ui.footerIconDisplay === footerIconDisplay.value &&
    typeof ui.sidebarOpen === "boolean" &&
    ui.sidebarOpen === sidebarOpen.value &&
    typeof ui.leftPanelCollapsed === "boolean" &&
    ui.leftPanelCollapsed === leftPanelCollapsed.value &&
    typeof ui.rightPanelCollapsed === "boolean" &&
    ui.rightPanelCollapsed === rightPanelCollapsed.value &&
    typeof ui.bottomPanelCollapsed === "boolean" &&
    ui.bottomPanelCollapsed === bottomPanelCollapsed.value

  // ============================================================================
  // Firestore Refs
  // ============================================================================

  const tabsDocRef = computed(() => {
    if (
      !user.value?.uid ||
      !currentTeam.value?.id ||
      !currentWorkspace.value?.id
    )
      return null
    return doc(
      collection(
        doc(
          collection(
            doc(
              collection(
                doc(collection(db, "teams"), currentTeam.value.id),
                "memberships"
              ),
              user.value.uid
            ),
            "workspaces"
          ),
          currentWorkspace.value.id
        ),
        "layout"
      ),
      "tabs"
    )
  })

  const navigationDocRef = computed(() => {
    if (!user.value?.uid) return null
    return doc(
      collection(doc(collection(db, "users"), user.value.uid), "layout"),
      "navigation"
    )
  })

  // ============================================================================
  // Hydration (VueFire) with Optimistic Protection
  // ============================================================================

  const { data: tabsDocData, pending: tabsPending } = useDocument(tabsDocRef)
  const { data: navDocData, pending: navPending } =
    useDocument(navigationDocRef)

  const isLoading = computed(
    () => (tabsPending.value || navPending.value) && !isHydrated.value
  )

  // Watch Tabs Data - protected against optimistic overwrites
  watch(
    tabsDocData,
    (doc) => {
      // Skip if any tab operations are pending
      if (pendingTabIds.value.size > 0) return

      // Skip if the document ref is null (user/team not loaded yet)
      // We only want to reset tabs when we have a valid ref but the doc doesn't exist
      if (!tabsDocRef.value) return

      if (!doc) {
        // Reset tabs when switching to a team with no saved tabs
        tabs.value = []
        activeTabId.value = ""
        recentlyClosed.value = []
        tabIndicators.value = {}
        return
      }

      const tabsDoc = toLayoutTabsDoc(doc)
      tabs.value = normalizeTabs(tabsDoc?.tabs ?? [])
      activeTabId.value = tabsDoc?.active ?? ""
      recentlyClosed.value = normalizeTabHistory(tabsDoc?.recentlyClosed ?? [])
      pruneTabIndicators(tabs.value)
    },
    { immediate: true }
  )

  // Reset tabs when team or workspace changes (tabsDocRef will update automatically)
  watch(
    [() => currentTeam.value?.id, () => currentWorkspace.value?.id],
    ([newTeamId, newWorkspaceId], [oldTeamId, oldWorkspaceId]) => {
      if (
        (newTeamId !== oldTeamId && oldTeamId !== undefined) ||
        (newWorkspaceId !== oldWorkspaceId && oldWorkspaceId !== undefined)
      ) {
        // Keep tab synchronization paused until the new workspace snapshot is ready.
        isHydrated.value = false

        // Clear local state while waiting for new team/workspace's tabs to load
        tabs.value = []
        activeTabId.value = ""
        recentlyClosed.value = []
        tabIndicators.value = {}
      }
    }
  )

  // Mark UI prefs as dirty immediately when changed locally.
  watch(
    [
      headerIconDisplay,
      footerIconDisplay,
      sidebarOpen,
      leftPanelCollapsed,
      rightPanelCollapsed,
      bottomPanelCollapsed,
    ],
    () => {
      if (isApplyingNavigationUiSnapshot.value) return
      navigationUiDirty.value = true
    },
    { flush: "sync" }
  )

  // Watch Navigation Data - protected against optimistic overwrites
  watch(
    navDocData,
    (doc) => {
      const navigationDoc = toLayoutNavigationDoc(doc)
      if (!navigationDoc) {
        if (!pendingNavigation.value && !navPending.value) {
          activeNavItems.value = [...defaultMenu]
        }
        return
      }

      const ui = isRecord(navigationDoc.ui) ? navigationDoc.ui : null
      if (ui && navigationUiDirty.value && isNavigationUiSnapshotInSync(ui)) {
        navigationUiDirty.value = false
      }

      if (ui && !pendingNavigationUi.value && !navigationUiDirty.value) {
        isApplyingNavigationUiSnapshot.value = true
        try {
          if (
            isIconDisplay(ui.headerIconDisplay) &&
            ui.headerIconDisplay !== headerIconDisplay.value
          ) {
            headerIconDisplay.value = ui.headerIconDisplay
          }
          if (
            isIconDisplay(ui.footerIconDisplay) &&
            ui.footerIconDisplay !== footerIconDisplay.value
          ) {
            footerIconDisplay.value = ui.footerIconDisplay
          }
          if (
            typeof ui.sidebarOpen === "boolean" &&
            ui.sidebarOpen !== sidebarOpen.value
          ) {
            sidebarOpen.value = ui.sidebarOpen
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
        } finally {
          isApplyingNavigationUiSnapshot.value = false
        }
      }

      // Skip nav reconciliation if navigation operation is pending
      if (pendingNavigation.value) return

      const savedVisibility = navigationDoc.visibleItems ?? {}
      const savedOrder = (navigationDoc.order ?? []).filter(
        (value): value is string => typeof value === "string"
      )

      const visibleIds = new Set<string>()
      for (const item of defaultMenu) {
        if (savedVisibility[item.id] !== false) {
          visibleIds.add(item.id)
        }
      }

      const newActiveItems: NavItem[] = []
      const processedIds = new Set<string>()

      for (const id of savedOrder) {
        const item = defaultMenu.find((i) => i.id === id)
        if (item && visibleIds.has(id)) {
          newActiveItems.push(item)
          processedIds.add(id)
        }
      }

      for (const item of defaultMenu) {
        if (visibleIds.has(item.id) && !processedIds.has(item.id)) {
          newActiveItems.push(item)
        }
      }

      activeNavItems.value = newActiveItems
    },
    { immediate: true }
  )

  // Set isHydrated when all critical documents are loaded or failed to load
  // Only set hydrated when we have valid refs (user/team loaded) AND documents are no longer pending
  watch(
    [tabsPending, navPending, tabsDocRef],
    ([tp, np, tabsRef]) => {
      // Don't mark as hydrated if we don't have a valid tabs doc ref yet
      // (meaning user or team hasn't loaded)
      if (!tabsRef) {
        isHydrated.value = false
        return
      }

      // Re-enter hydration mode whenever any layout document is refreshing.
      if (tp || np) {
        isHydrated.value = false
        return
      }

      isHydrated.value = true
    },
    { immediate: true }
  )

  // ============================================================================
  // Persistence Helpers
  // ============================================================================

  /**
   * Safely persist to Firestore with error handling and rollback support
   * @returns true if successful, false if failed
   */
  async function safeSetDoc(
    docRef: ReturnType<typeof doc> | null,
    data: Record<string, unknown>,
    source: string
  ): Promise<boolean> {
    if (!docRef) return false
    try {
      await mutateSetDocument(docRef, data, {
        source,
        merge: true,
      })
      return true
    } catch (error) {
      console.error("[layoutStore] Failed to persist to Firestore:", error)
      return false
    }
  }

  /**
   * Persist tabs with optimistic update protection
   */
  async function persistTabs(): Promise<boolean> {
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

  /**
   * Persist UI layout preferences with optimistic update protection
   */
  async function persistNavigationUiState(): Promise<boolean> {
    return safeSetDoc(
      navigationDocRef.value,
      {
        ui: getNavigationUiState(),
      },
      "layout.navigation.ui.persist"
    )
  }

  /**
   * Persist navigation with optimistic update protection
   */
  async function persistNavigation(): Promise<boolean> {
    if (!navigationDocRef.value) return false

    const visibleItems: Record<string, boolean> = {}
    const order = activeNavItems.value.map((item) => item.id)
    const activeIds = new Set(order)

    for (const item of defaultMenu) {
      visibleItems[item.id] = activeIds.has(item.id)
    }

    return safeSetDoc(
      navigationDocRef.value,
      { visibleItems, order },
      "layout.navigation.persist"
    )
  }

  /**
   * Persist UI layout state with global sync queue tracking.
   * Queues one extra run when rapid toggle changes happen during a save.
   */
  async function persistNavigationUiWithSync(): Promise<void> {
    if (!navigationDocRef.value) return

    if (pendingNavigationUi.value) {
      isNavigationUiPersistQueued.value = true
      return
    }

    pendingNavigationUi.value = true
    isNavigationUiPersistQueued.value = false

    try {
      await withCloudSyncOperation(
        async () => {
          const success = await persistNavigationUiState()
          if (!success) {
            throw new Error("Failed to persist navigation ui state")
          }
        },
        {
          id: "navigation-ui",
          source: "layout.navigation.ui.persist",
        }
      )
    } catch (error) {
      // Keep local state and avoid revert; the next local change will retry.
      console.error("[layoutStore] persistNavigationUi failed:", error)
    } finally {
      pendingNavigationUi.value = false

      if (isNavigationUiPersistQueued.value) {
        void persistNavigationUiWithSync()
      }
    }
  }

  // ============================================================================
  // Debounced Persistence Watchers
  // ============================================================================

  // Persist Tabs (debounced)
  watchDebounced(
    [tabs, activeTabId, recentlyClosed],
    () => {
      // Skip persistence during pending operations (will be handled by the action)
      if (pendingTabIds.value.size > 0) return
      if (!tabsDocRef.value || tabsPending.value || !isHydrated.value) return
      persistTabs()
    },
    { debounce: 500, deep: true }
  )

  // Persist Navigation (debounced)
  watchDebounced(
    activeNavItems,
    () => {
      // Skip persistence during pending operations
      if (pendingNavigation.value) return
      persistNavigation()
    },
    { debounce: 500, deep: true }
  )

  // Persist UI Layout State (debounced)
  watchDebounced(
    [
      headerIconDisplay,
      footerIconDisplay,
      sidebarOpen,
      leftPanelCollapsed,
      rightPanelCollapsed,
      bottomPanelCollapsed,
    ],
    () => {
      if (!navigationUiDirty.value) return
      void persistNavigationUiWithSync()
    },
    { debounce: 500 }
  )

  // ============================================================================
  // Actions: Tabs (with Optimistic Updates)
  // ============================================================================

  function createTab(
    fullPath: string,
    name?: string,
    options?: { pinned?: boolean }
  ): Tab {
    if (name) {
      return {
        id: generateId(),
        name,
        fullPath,
        pinned: Boolean(options?.pinned),
      }
    }
    // Note: Router resolution usually happens in component,
    // but we can pass the resolved name or handle it here if we had access to router.
    // For now, we'll expect the component to pass a name or we use a default.
    return {
      id: generateId(),
      name: "New tab",
      fullPath,
      pinned: Boolean(options?.pinned),
    }
  }

  function normalizeTabOrder() {
    tabs.value = normalizeTabs(tabs.value)
  }

  function pruneTabIndicators(nextTabs = tabs.value) {
    const validIds = new Set(nextTabs.map((tab) => tab.id))
    tabIndicators.value = Object.fromEntries(
      Object.entries(tabIndicators.value).filter(([id]) => validIds.has(id))
    )
  }

  function setTabIndicator(id: string, indicator: LayoutTabIndicator) {
    if (!tabs.value.some((tab) => tab.id === id)) return
    tabIndicators.value = {
      ...tabIndicators.value,
      [id]: indicator,
    }
  }

  function clearTabIndicator(id: string) {
    if (!tabIndicators.value[id]) return

    const remainingIndicators = { ...tabIndicators.value }
    delete remainingIndicators[id]
    tabIndicators.value = remainingIndicators
  }

  function getTabIndicator(id: string) {
    return tabIndicators.value[id] ?? null
  }

  /**
   * Add a new tab with optimistic update
   */
  async function addTab(
    fullPath = "/new",
    name = "New tab",
    options?: { pinned?: boolean }
  ): Promise<Tab> {
    const newTab = createTab(fullPath, name, options)

    // Clone previous state for rollback
    const previousTabs = cloneState(tabs.value)
    const previousActiveTabId = activeTabId.value

    await withOptimisticUpdate(
      pendingTabIds,
      newTab.id,
      // Apply optimistic update
      () => {
        tabs.value = normalizeTabs([...tabs.value, newTab])
        activeTabId.value = newTab.id
      },
      // Rollback on error
      () => {
        tabs.value = previousTabs
        activeTabId.value = previousActiveTabId
      },
      // Persistence
      async () => {
        const success = await persistTabs()
        if (!success) {
          throw new Error("Failed to persist tab")
        }
      }
    )

    return newTab
  }

  function addToHistory(tab: Tab) {
    const head = recentlyClosed.value[0]
    if (
      head?.fullPath === tab.fullPath &&
      head?.name === tab.name &&
      head?.pinned === Boolean(tab.pinned)
    )
      return
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

  /**
   * Close a tab with optimistic update
   */
  async function closeTab(id: string): Promise<{ nextPath: string } | null> {
    const idx = tabs.value.findIndex((t) => t.id === id)
    if (idx === -1) return null

    const closing = tabs.value[idx]
    if (!closing) return null
    if (closing.pinned) return null

    // Clone previous state for rollback
    const previousTabs = cloneState(tabs.value)
    const previousActiveTabId = activeTabId.value
    const previousRecentlyClosed = cloneState(recentlyClosed.value)
    const previousTabIndicators = cloneState(tabIndicators.value)

    let nextPathResult: string | null = null

    await withOptimisticUpdate(
      pendingTabIds,
      id,
      // Apply optimistic update
      () => {
        // Add to history
        addToHistory(closing)

        // Prepare new state
        const newTabs = [...tabs.value]
        newTabs.splice(idx, 1)

        let nextId = activeTabId.value

        if (newTabs.length === 0) {
          nextId = ""
          nextPathResult = "/start"
        } else if (closing.id === activeTabId.value) {
          const nextTab = newTabs[idx] || newTabs[idx - 1]
          if (nextTab) {
            nextId = nextTab.id
            nextPathResult = nextTab.fullPath
          }
        }

        tabs.value = normalizeTabs(newTabs)
        activeTabId.value = nextId
        pruneTabIndicators(newTabs)
      },
      // Rollback on error
      () => {
        tabs.value = previousTabs
        activeTabId.value = previousActiveTabId
        recentlyClosed.value = previousRecentlyClosed
        tabIndicators.value = previousTabIndicators
      },
      // Persistence
      async () => {
        const success = await persistTabs()
        if (!success) {
          throw new Error("Failed to persist tab close")
        }
      }
    )

    return nextPathResult ? { nextPath: nextPathResult } : null
  }

  /**
   * Close all tabs except one with optimistic update
   */
  async function closeOtherTabs(keepId: string): Promise<void> {
    const keep = tabs.value.find((t) => t.id === keepId)
    if (!keep) return

    // Clone previous state for rollback
    const previousTabs = cloneState(tabs.value)
    const previousActiveTabId = activeTabId.value
    const previousRecentlyClosed = cloneState(recentlyClosed.value)
    const previousTabIndicators = cloneState(tabIndicators.value)

    // Use loop to execute updates for "other" tabs since we don't have a single ID
    // But since we persist the whole tabs collection, we can just use keepId as the pending key
    // or maybe a special key. However, withOptimisticUpdate expects a single ID key.
    // For bulk operations that affect the whole collection, we can pick the 'keepId' or a generic key.
    // Let's use keepId as the primary key since that's the one remaining.

    // To prevent interaction with other tabs during this, we ideally mark them all.
    // withOptimisticUpdate only marks one ID.
    // So we will manually mark others, and let withOptimisticUpdate handle the main one.

    const tabsToClose = tabs.value.filter((t) => !t.pinned && t.id !== keepId)
    if (tabsToClose.length === 0) {
      activeTabId.value = keep.id
      return
    }
    tabsToClose.forEach((t) => addPending(pendingTabIds, t.id))

    try {
      await withOptimisticUpdate(
        pendingTabIds,
        keepId,
        // Apply optimistic update
        () => {
          tabsToClose.forEach(addToHistory)
          const remainingTabs = normalizeTabs(
            tabs.value.filter((t) => t.pinned || t.id === keepId)
          )
          tabs.value = remainingTabs
          activeTabId.value = keep.id
          pruneTabIndicators(remainingTabs)
        },
        // Rollback on error
        () => {
          tabs.value = previousTabs
          activeTabId.value = previousActiveTabId
          recentlyClosed.value = previousRecentlyClosed
          tabIndicators.value = previousTabIndicators
        },
        // Persistence
        async () => {
          const success = await persistTabs()
          if (!success) {
            throw new Error("Failed to persist closeOtherTabs")
          }
        }
      )
    } finally {
      tabsToClose.forEach((t) => removePending(pendingTabIds, t.id))
    }
  }

  /**
   * Close all tabs with optimistic update
   */
  async function closeAllTabs(): Promise<void> {
    const tabsToClose = tabs.value.filter((tab) => !tab.pinned)
    if (tabsToClose.length === 0) return

    // Clone previous state for rollback
    const previousTabs = cloneState(tabs.value)
    const previousActiveTabId = activeTabId.value
    const previousRecentlyClosed = cloneState(recentlyClosed.value)
    const previousTabIndicators = cloneState(tabIndicators.value)

    // Mark all as pending manually except one to carry the operation?
    // Or we use a special ID like 'all-tabs' but that might not block individual tab clicks if logic checks tab.id
    // It's safer to mark all.
    tabsToClose.forEach((t) => addPending(pendingTabIds, t.id))

    try {
      await withCloudSyncOperation(
        async () => {
          tabsToClose.forEach(addToHistory)
          const remainingTabs = normalizeTabs(
            tabs.value.filter((tab) => tab.pinned)
          )
          const nextActiveTab = remainingTabs.find(
            (tab) => tab.id === activeTabId.value
          )
          tabs.value = remainingTabs
          activeTabId.value = nextActiveTab?.id ?? remainingTabs[0]?.id ?? ""
          pruneTabIndicators(remainingTabs)

          const success = await persistTabs()
          if (!success) throw new Error("Failed to persist closeAllTabs")
        },
        {
          id: "all",
          source: "layout.tabs.closeAll",
        }
      )
    } catch (error) {
      tabs.value = previousTabs
      activeTabId.value = previousActiveTabId
      recentlyClosed.value = previousRecentlyClosed
      tabIndicators.value = previousTabIndicators
      console.error("[layoutStore] closeAllTabs failed:", error)
      throw error
    } finally {
      tabsToClose.forEach((t) => removePending(pendingTabIds, t.id))
    }
  }

  function clearRecentlyClosed() {
    recentlyClosed.value = []
  }

  /**
   * Reopen the last closed tab
   */
  function reopenLastClosed(): Tab | null {
    if (recentlyClosed.value.length === 0) return null
    const [last, ...rest] = recentlyClosed.value
    if (!last) return null
    recentlyClosed.value = rest
    return last
  }

  /**
   * Duplicate a tab with optimistic update
   */
  async function duplicateTab(id: string): Promise<void> {
    const tab = tabs.value.find((t) => t.id === id)
    if (!tab) return
    if (isDefaultRoute(tab)) return

    const duplicate = createTab(
      tab.fullPath,
      tab.name.endsWith(" (Copy)") ? tab.name : `${tab.name} (Copy)`,
      { pinned: false }
    )

    // Clone previous state for rollback
    const previousTabs = cloneState(tabs.value)
    const previousActiveTabId = activeTabId.value

    await withOptimisticUpdate(
      pendingTabIds,
      duplicate.id,
      // Apply optimistic update
      () => {
        tabs.value = normalizeTabs([...tabs.value, duplicate])
        activeTabId.value = duplicate.id
      },
      // Rollback on error
      () => {
        tabs.value = previousTabs
        activeTabId.value = previousActiveTabId
      },
      // Persistence
      async () => {
        const success = await persistTabs()
        if (!success) {
          throw new Error("Failed to persist duplicateTab")
        }
      }
    )
  }

  /**
   * Rename a tab with optimistic update
   */
  async function renameTab(id: string, newName: string): Promise<void> {
    const tab = tabs.value.find((t) => t.id === id)
    if (!tab) return
    if (isDefaultRoute(tab)) return
    if (!newName.trim()) return

    // Clone previous state for rollback
    const previousTabs = cloneState(tabs.value)

    await withOptimisticUpdate(
      pendingTabIds,
      id,
      // Apply optimistic update
      () => {
        tabs.value = tabs.value.map((t) =>
          t.id === id ? { ...t, name: newName.trim() } : t
        )
      },
      // Rollback on error
      () => {
        tabs.value = previousTabs
      },
      // Persistence
      async () => {
        const success = await persistTabs()
        if (!success) {
          throw new Error("Failed to persist renameTab")
        }
      }
    )
  }

  async function setTabPinned(id: string, pinned: boolean): Promise<void> {
    const tab = tabs.value.find((t) => t.id === id)
    if (!tab) return
    if (tab.pinned === pinned) return

    const previousTabs = cloneState(tabs.value)

    await withOptimisticUpdate(
      pendingTabIds,
      id,
      () => {
        tabs.value = normalizeTabs(
          tabs.value.map((t) => (t.id === id ? { ...t, pinned } : t))
        )
      },
      () => {
        tabs.value = previousTabs
      },
      async () => {
        const success = await persistTabs()
        if (!success) {
          throw new Error("Failed to persist setTabPinned")
        }
      }
    )
  }

  function setActiveTab(id: string) {
    activeTabId.value = id
  }

  function updateActiveTab(fullPath: string, name?: string) {
    if (!activeTabId.value) return
    const activeTabIndex = tabs.value.findIndex(
      (t) => t.id === activeTabId.value
    )
    if (activeTabIndex !== -1) {
      tabs.value = tabs.value.map((t, i) =>
        i === activeTabIndex ? { ...t, fullPath, ...(name ? { name } : {}) } : t
      )
    }
  }

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
          const success = await persistNavigation()
          if (!success) {
            throw new Error(`Failed to persist ${options.actionName}`)
          }
        },
        {
          id: options.id,
          source: options.source,
        }
      )
    } catch (error) {
      activeNavItems.value = previousNavItems
      console.error(`[layoutStore] ${options.actionName} failed:`, error)
      throw error
    } finally {
      pendingNavigation.value = false
    }
  }

  // ============================================================================
  // Actions: Navigation (with Optimistic Updates)
  // ============================================================================

  /**
   * Toggle a navigation item's visibility with optimistic update
   */
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
          const item = defaultMenu.find((i) => i.id === itemId)
          if (item && !activeNavItems.value.some((i) => i.id === itemId)) {
            activeNavItems.value = [...activeNavItems.value, item]
          }
          return
        }

        activeNavItems.value = activeNavItems.value.filter(
          (i) => i.id !== itemId
        )
      },
    })
  }

  /**
   * Set navigation items with optimistic update
   */
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

  /**
   * Reset navigation items to defaults with optimistic update
   */
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
    headerIconDisplay,
    footerIconDisplay,
    sidebarOpen,
    leftPanelCollapsed,
    rightPanelCollapsed,
    bottomPanelCollapsed,
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
    addToHistory,
    clearRecentlyClosed,
    reopenLastClosed,
    normalizeTabOrder,
  }
})
