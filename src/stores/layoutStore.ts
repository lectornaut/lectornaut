/**
 * Layout Store with Optimistic Firestore Updates
 *
 * Manages tabs, navigation, and theme settings with:
 * - Instant UI updates via optimistic state changes
 * - Automatic rollback on Firestore errors
 * - pendingIds tracking to prevent snapshot overwrites
 * - Debounced persistence to Firestore
 */

import type {
  AccentId,
  BaseId,
  FontId,
  LanguageId,
  SizeId,
  ThemeId,
} from "@/helpers/defaults"
import {
  defaultAccent,
  defaultBase,
  defaultFont,
  defaultLanguage,
  defaultMenu,
  defaultSize,
} from "@/helpers/defaults"
import { generateId, isDefaultRoute } from "@/helpers/utilities"
import { useTeamStore } from "@/stores/teamStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
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

export type Tab = {
  id: string
  name: string
  fullPath: string
}

export type NavItem = (typeof defaultMenu)[number]

export type ThemeMode = ThemeId
export type IconDisplay = "icon" | "text"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isIconDisplay = (value: unknown): value is IconDisplay =>
  value === "icon" || value === "text"

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

  // Pre-load from localStorage to avoid flash
  const mode = useStorage<ThemeMode>("theme", "auto")
  const base = useStorage<BaseId>("base", defaultBase)
  const accent = useStorage<AccentId>("accent", defaultAccent)
  const font = useStorage<FontId>("font", defaultFont)
  const size = useStorage<SizeId>("size", defaultSize)
  const language = useStorage<LanguageId>("language", defaultLanguage)
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
  const activeNavItems = ref<NavItem[]>([])
  const isHydrated = ref(false)

  // Pending operation tracking
  const pendingTabIds = shallowRef(createPendingSet())
  const pendingNavigation = shallowRef(false)
  const pendingTheme = shallowRef(false)
  const isThemePersistQueued = ref(false)

  // Theme State - use storage refs directly to avoid double-wrapping
  const themeSettings = reactive({
    mode,
    base,
    accent,
    font,
    size,
    language,
  })

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

  const themeDocRef = computed(() => {
    if (!user.value?.uid) return null
    return doc(
      collection(doc(collection(db, "users"), user.value.uid), "layout"),
      "theme"
    )
  })

  // ============================================================================
  // Hydration (VueFire) with Optimistic Protection
  // ============================================================================

  const { data: tabsDocData, pending: tabsPending } = useDocument(tabsDocRef)
  const { data: navDocData, pending: navPending } =
    useDocument(navigationDocRef)
  const { data: themeDocData, pending: themePending } = useDocument(themeDocRef)

  const isLoading = computed(
    () =>
      (tabsPending.value || navPending.value || themePending.value) &&
      !isHydrated.value
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
        return
      }
      tabs.value = doc.tabs ?? []
      activeTabId.value = doc.active ?? ""
      recentlyClosed.value = doc.recentlyClosed ?? []
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
        // Clear local state while waiting for new team/workspace's tabs to load
        tabs.value = []
        activeTabId.value = ""
        recentlyClosed.value = []
      }
    }
  )

  // Watch Navigation Data - protected against optimistic overwrites
  watch(
    navDocData,
    (doc) => {
      if (!doc) {
        if (!pendingNavigation.value && !navPending.value) {
          activeNavItems.value = [...defaultMenu]
        }
        return
      }

      const ui = isRecord(doc.ui) ? doc.ui : null
      if (ui) {
        if (
          "headerIconDisplay" in ui &&
          isIconDisplay(ui.headerIconDisplay) &&
          ui.headerIconDisplay !== headerIconDisplay.value
        ) {
          headerIconDisplay.value = ui.headerIconDisplay
        }
        if (
          "footerIconDisplay" in ui &&
          isIconDisplay(ui.footerIconDisplay) &&
          ui.footerIconDisplay !== footerIconDisplay.value
        ) {
          footerIconDisplay.value = ui.footerIconDisplay
        }
        if (
          "sidebarOpen" in ui &&
          typeof ui.sidebarOpen === "boolean" &&
          ui.sidebarOpen !== sidebarOpen.value
        ) {
          sidebarOpen.value = ui.sidebarOpen
        }
        if (
          "leftPanelCollapsed" in ui &&
          typeof ui.leftPanelCollapsed === "boolean" &&
          ui.leftPanelCollapsed !== leftPanelCollapsed.value
        ) {
          leftPanelCollapsed.value = ui.leftPanelCollapsed
        }
        if (
          "rightPanelCollapsed" in ui &&
          typeof ui.rightPanelCollapsed === "boolean" &&
          ui.rightPanelCollapsed !== rightPanelCollapsed.value
        ) {
          rightPanelCollapsed.value = ui.rightPanelCollapsed
        }
        if (
          "bottomPanelCollapsed" in ui &&
          typeof ui.bottomPanelCollapsed === "boolean" &&
          ui.bottomPanelCollapsed !== bottomPanelCollapsed.value
        ) {
          bottomPanelCollapsed.value = ui.bottomPanelCollapsed
        }
      }

      // Skip nav reconciliation if navigation operation is pending
      if (pendingNavigation.value) return

      const savedVisibility = doc.visibleItems || {}
      const savedOrder: string[] = doc.order || []

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

  // Sync Firestore theme data back to localStorage - protected against optimistic overwrites
  watch(
    themeDocData,
    (doc) => {
      // Skip if theme operation is pending
      if (pendingTheme.value) return

      if (!doc) return
      // Only sync if values differ (avoids unnecessary localStorage writes)
      // Use 'in' operator to check for key existence rather than truthy value
      if ("mode" in doc && doc.mode !== mode.value) mode.value = doc.mode
      if ("base" in doc && doc.base !== base.value) base.value = doc.base
      if ("accent" in doc && doc.accent !== accent.value)
        accent.value = doc.accent
      if ("font" in doc && doc.font !== font.value) font.value = doc.font
      if ("size" in doc && doc.size !== size.value) size.value = doc.size
      if ("language" in doc && doc.language !== language.value)
        language.value = doc.language
    },
    { immediate: true }
  )

  // Set isHydrated when all critical documents are loaded or failed to load
  // Only set hydrated when we have valid refs (user/team loaded) AND documents are no longer pending
  watch(
    [tabsPending, navPending, themePending, tabsDocRef],
    ([tp, np, thp, tabsRef]) => {
      // Don't mark as hydrated if we don't have a valid tabs doc ref yet
      // (meaning user or team hasn't loaded)
      if (!tabsRef) {
        isHydrated.value = false
        return
      }
      if (!tp && !np && !thp) {
        isHydrated.value = true
      }
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
        ui: {
          headerIconDisplay: headerIconDisplay.value,
          footerIconDisplay: footerIconDisplay.value,
          sidebarOpen: sidebarOpen.value,
          leftPanelCollapsed: leftPanelCollapsed.value,
          rightPanelCollapsed: rightPanelCollapsed.value,
          bottomPanelCollapsed: bottomPanelCollapsed.value,
        },
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
   * Persist theme with optimistic update protection
   */
  async function persistTheme(): Promise<boolean> {
    return safeSetDoc(
      themeDocRef.value,
      {
        mode: mode.value,
        base: base.value,
        accent: accent.value,
        font: font.value,
        size: size.value,
        language: language.value,
      },
      "layout.theme.persist"
    )
  }

  /**
   * Persist theme with global sync queue tracking.
   * Queues one extra run when multiple theme changes happen during a save.
   */
  async function persistThemeWithSync(): Promise<void> {
    if (!themeDocRef.value) return

    if (pendingTheme.value) {
      isThemePersistQueued.value = true
      return
    }

    pendingTheme.value = true
    isThemePersistQueued.value = false

    try {
      await withCloudSyncOperation(
        async () => {
          const success = await persistTheme()
          if (!success) {
            throw new Error("Failed to persist theme")
          }
        },
        {
          id: "theme",
          source: "layout.theme.persist",
        }
      )
    } catch (error) {
      console.error("[layoutStore] persistTheme failed:", error)
    } finally {
      pendingTheme.value = false

      if (isThemePersistQueued.value) {
        void persistThemeWithSync()
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
      persistNavigationUiState()
    },
    { debounce: 500 }
  )

  // Persist Theme (debounced)
  watchDebounced(
    [mode, base, accent, font, size, language],
    () => {
      void persistThemeWithSync()
    },
    { debounce: 500 }
  )

  // ============================================================================
  // Actions: Tabs (with Optimistic Updates)
  // ============================================================================

  function createTab(fullPath: string, name?: string): Tab {
    if (name) {
      return { id: generateId(), name, fullPath }
    }
    // Note: Router resolution usually happens in component,
    // but we can pass the resolved name or handle it here if we had access to router.
    // For now, we'll expect the component to pass a name or we use a default.
    return { id: generateId(), name: "New tab", fullPath }
  }

  /**
   * Add a new tab with optimistic update
   */
  async function addTab(fullPath = "/new", name = "New tab"): Promise<Tab> {
    const newTab = createTab(fullPath, name)

    // Clone previous state for rollback
    const previousTabs = cloneState(tabs.value)
    const previousActiveTabId = activeTabId.value

    await withOptimisticUpdate(
      pendingTabIds,
      newTab.id,
      // Apply optimistic update
      () => {
        tabs.value = [...tabs.value, newTab]
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
    if (head?.fullPath === tab.fullPath && head?.name === tab.name) return
    recentlyClosed.value = [
      {
        id: generateId(),
        name: tab.name,
        fullPath: tab.fullPath,
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

    // Clone previous state for rollback
    const previousTabs = cloneState(tabs.value)
    const previousActiveTabId = activeTabId.value
    const previousRecentlyClosed = cloneState(recentlyClosed.value)

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

        tabs.value = newTabs
        activeTabId.value = nextId
      },
      // Rollback on error
      () => {
        tabs.value = previousTabs
        activeTabId.value = previousActiveTabId
        recentlyClosed.value = previousRecentlyClosed
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

    // Use loop to execute updates for "other" tabs since we don't have a single ID
    // But since we persist the whole tabs collection, we can just use keepId as the pending key
    // or maybe a special key. However, withOptimisticUpdate expects a single ID key.
    // For bulk operations that affect the whole collection, we can pick the 'keepId' or a generic key.
    // Let's use keepId as the primary key since that's the one remaining.

    // To prevent interaction with other tabs during this, we ideally mark them all.
    // withOptimisticUpdate only marks one ID.
    // So we will manually mark others, and let withOptimisticUpdate handle the main one.

    const tabsToClose = tabs.value.filter((t) => t.id !== keepId)
    tabsToClose.forEach((t) => addPending(pendingTabIds, t.id))

    try {
      await withOptimisticUpdate(
        pendingTabIds,
        keepId,
        // Apply optimistic update
        () => {
          tabsToClose.forEach(addToHistory)
          tabs.value = [keep]
          activeTabId.value = keep.id
        },
        // Rollback on error
        () => {
          tabs.value = previousTabs
          activeTabId.value = previousActiveTabId
          recentlyClosed.value = previousRecentlyClosed
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
    if (tabs.value.length === 0) return

    // Clone previous state for rollback
    const previousTabs = cloneState(tabs.value)
    const previousActiveTabId = activeTabId.value
    const previousRecentlyClosed = cloneState(recentlyClosed.value)

    const tabsToClose = [...tabs.value]
    // Mark all as pending manually except one to carry the operation?
    // Or we use a special ID like 'all-tabs' but that might not block individual tab clicks if logic checks tab.id
    // It's safer to mark all.
    tabsToClose.forEach((t) => addPending(pendingTabIds, t.id))

    try {
      await withCloudSyncOperation(
        async () => {
          tabsToClose.forEach(addToHistory)
          tabs.value = []
          activeTabId.value = ""

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
      tab.name.endsWith(" (Copy)") ? tab.name : `${tab.name} (Copy)`
    )

    // Clone previous state for rollback
    const previousTabs = cloneState(tabs.value)
    const previousActiveTabId = activeTabId.value

    await withOptimisticUpdate(
      pendingTabIds,
      duplicate.id,
      // Apply optimistic update
      () => {
        tabs.value = [...tabs.value, duplicate]
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
    // Clone previous state for rollback
    const previousNavItems = cloneState(activeNavItems.value)

    // Mark as pending
    pendingNavigation.value = true

    try {
      // Apply optimistic update
      if (checked) {
        const item = defaultMenu.find((i) => i.id === itemId)
        if (item && !activeNavItems.value.some((i) => i.id === itemId)) {
          activeNavItems.value = [...activeNavItems.value, item]
        }
      } else {
        activeNavItems.value = activeNavItems.value.filter(
          (i) => i.id !== itemId
        )
      }

      await withCloudSyncOperation(
        async () => {
          const success = await persistNavigation()
          if (!success) {
            throw new Error("Failed to persist toggleNavItem")
          }
        },
        {
          id: itemId,
          source: "layout.navigation.toggle",
        }
      )
    } catch (error) {
      // Rollback on error
      activeNavItems.value = previousNavItems
      console.error("[layoutStore] toggleNavItem failed:", error)
      throw error
    } finally {
      pendingNavigation.value = false
    }
  }

  /**
   * Set navigation items with optimistic update
   */
  async function setNavItems(items: NavItem[]): Promise<void> {
    // Clone previous state for rollback
    const previousNavItems = cloneState(activeNavItems.value)

    // Mark as pending
    pendingNavigation.value = true

    try {
      // Apply optimistic update
      activeNavItems.value = cloneState(items)

      await withCloudSyncOperation(
        async () => {
          const success = await persistNavigation()
          if (!success) {
            throw new Error("Failed to persist setNavItems")
          }
        },
        {
          id: "set",
          source: "layout.navigation.set",
        }
      )
    } catch (error) {
      // Rollback on error
      activeNavItems.value = previousNavItems
      console.error("[layoutStore] setNavItems failed:", error)
      throw error
    } finally {
      pendingNavigation.value = false
    }
  }

  /**
   * Reset navigation items to defaults with optimistic update
   */
  async function resetNavItems(): Promise<void> {
    // Clone previous state for rollback
    const previousNavItems = cloneState(activeNavItems.value)

    // Mark as pending
    pendingNavigation.value = true

    try {
      // Apply optimistic update
      activeNavItems.value = [...defaultMenu]

      await withCloudSyncOperation(
        async () => {
          const success = await persistNavigation()
          if (!success) {
            throw new Error("Failed to persist resetNavItems")
          }
        },
        {
          id: "reset",
          source: "layout.navigation.reset",
        }
      )
    } catch (error) {
      // Rollback on error
      activeNavItems.value = previousNavItems
      console.error("[layoutStore] resetNavItems failed:", error)
      throw error
    } finally {
      pendingNavigation.value = false
    }
  }

  return {
    // State
    tabs,
    activeTabId,
    activeTab,
    recentlyClosed,
    activeNavItems,
    themeSettings,
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
    pendingTheme,
    isTabPending,
    hasAnyTabPending,

    // Actions
    addTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    duplicateTab,
    renameTab,
    setActiveTab,
    updateActiveTab,
    toggleNavItem,
    setNavItems,
    resetNavItems,
    addToHistory,
    clearRecentlyClosed,
    reopenLastClosed,
  }
})
