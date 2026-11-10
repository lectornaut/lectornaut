/**
 * Route ⇄ tab-strip wiring. {@link useTabsStore} stays the source of truth;
 * this module connects the URL to it and back. Two exports, two lifetimes:
 *
 * - {@link useTabRouterSync} — call ONCE, from App.vue. Two watchers keep the
 *   URL and the store in agreement for the app's whole life:
 *     1. Route → Store (primary): the URL is authoritative; every change
 *        activates an existing tab, consumes a throwaway "/new", reuses the
 *        active tab for in-app navigation, restores the last session, or
 *        finally opens a fresh tab. Also detects workspace switches.
 *     2. Store → Route (secondary): when the active tab's path changes, follow.
 *   It used to live in Tabbar, which remounts on every layout change
 *   (`app` → `bot`); each remount restarted "initial sync" and the next link
 *   opened a new tab. App-level, it can't be remounted.
 *
 * - {@link useTabActions} — Tabbar's menu entry points + the `Tabs.*` mitt
 *   bridge (hotkeys). Stateless, so living in a remounting component is fine.
 */
import { requestAppClose } from "@/composables/useCloseConfirmation"
import { isBrowser, isMainTauriWindow } from "@/composables/usePlatform"
import { resolveRouteName } from "@/helpers/breadcrumber"
import { emitter } from "@/modules/mitt"
import { useTabsStore } from "@/stores/tabsStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { storeToRefs } from "pinia"
import { computed, onMounted, onUnmounted, watch } from "vue"
import { useRoute, useRouter } from "vue-router"

export function useTabRouterSync() {
  const router = useRouter()
  const route = useRoute()

  const tabsStore = useTabsStore()
  const { tabs, activeTabId, activeTab, isHydrated } = storeToRefs(tabsStore)
  const { addTab, setActiveTab, updateActiveTab } = tabsStore
  const { currentWorkspace } = storeToRefs(useWorkspaceStore())

  // Only routes that render the tab strip take part: the `app` layout minus
  // `?popout=1` pages — and only in the main window, never a Tauri pop-out
  // (`ask-*`), which shares the same tabs doc.
  const syncsTabs = computed(
    () =>
      (isBrowser.value || isMainTauriWindow.value) &&
      route.meta.layout === "app" &&
      route.query.popout !== "1"
  )

  // Sync bookkeeping. Plain locals: nothing watches them, and this runs once.
  let isInitialRouteSync = true
  let syncedWorkspaceId: string | undefined
  let lastRoutePath: string | undefined
  // Route showing when the workspace switched; consumed on the first hydrated
  // sync so it isn't materialized as a tab in the new workspace.
  let switchedFromPath: string | null = null

  // ----------------------------------------------------------------------------
  // Core synchronization: Route → Store (primary truth)
  //
  // When the URL changes, reflect it in the store — activating an existing tab,
  // consuming a throwaway "/new" tab, reusing the active tab for in-app
  // navigation, restoring the last session, or finally adding a new tab.
  // ----------------------------------------------------------------------------
  watch(
    [() => route.fullPath, isHydrated, () => currentWorkspace.value?.id],
    async ([newPath, hydrated, workspaceId]) => {
      // Workspace switch: re-enter the initial-sync phase and remember the
      // outgoing route. Compared against the last *synced* workspace (module
      // scope), not the watcher's old value, so a Tabbar remount never reads as
      // a switch.
      const outgoingPath = lastRoutePath
      lastRoutePath = newPath
      if (workspaceId !== syncedWorkspaceId) {
        const isSwitch = syncedWorkspaceId !== undefined
        syncedWorkspaceId = workspaceId
        isInitialRouteSync = true
        switchedFromPath = isSwitch ? (outgoingPath ?? newPath) : null
      }

      if (!hydrated || !currentWorkspace.value || !syncsTabs.value) return

      // Still on the old workspace's route → redirect to a sensible fallback
      // instead of materializing it as a tab here. (The same route can
      // legitimately exist in both workspaces, hence the equality check.)
      const fromPath = switchedFromPath
      switchedFromPath = null
      if (fromPath === newPath) {
        const fallbackPath =
          activeTab.value?.fullPath ?? tabs.value[0]?.fullPath ?? "/start"
        if (fallbackPath !== newPath) {
          router.replace(fallbackPath)
          return
        }
      }

      // Already the active tab → nothing to do. Lets several "/new" tabs coexist
      // without snapping back to the first one.
      if (activeTab.value?.fullPath === newPath) {
        isInitialRouteSync = false
        return
      }

      // Case A: route matches an existing tab (excluding the reusable "/new").
      const existingTab = tabs.value.find((tab) => tab.fullPath === newPath)
      if (existingTab && newPath !== "/new") {
        setActiveTab(existingTab.id)
        isInitialRouteSync = false
        return
      }

      // Case B: the active tab is a throwaway "/new" → consume it for this route.
      if (activeTab.value?.fullPath === "/new") {
        updateActiveTab(newPath, resolveRouteName(route))
        isInitialRouteSync = false
        return
      }

      // Case C: in-app navigation → reuse the active tab (never on initial sync,
      // never for "/start").
      if (!isInitialRouteSync && activeTabId.value && newPath !== "/start") {
        updateActiveTab(newPath, resolveRouteName(route))
        return
      }

      // Case D: landed on "/start" with a remembered active tab → restore it.
      if (newPath === "/start" && activeTabId.value) {
        const tab = tabs.value.find((entry) => entry.id === activeTabId.value)
        if (tab) {
          router.push(tab.fullPath)
          return
        }
      }

      // Case E: fall back to opening a fresh tab (optimistic add sets active id).
      if (route.name) {
        await addTab(newPath, resolveRouteName(route))
      }

      isInitialRouteSync = false
    },
    { immediate: true }
  )

  // ----------------------------------------------------------------------------
  // Store → Route (secondary truth): when the active tab's path changes, follow.
  // ----------------------------------------------------------------------------
  watch(
    () => activeTab.value?.fullPath,
    (newPath) => {
      if (!isHydrated.value || !syncsTabs.value) return

      // An intentionally-emptied strip (no active tab, zero tabs) always resolves
      // to /start — and must do so even while `isInitialRouteSync` is still true.
      // That flag is set by the workspace-switch watcher and only cleared once the
      // Route→Store reconciliation settles; a switch whose persistence is lagging
      // or failing can leave it stuck true, which previously suppressed this
      // redirect and stranded the user on the last route with no tabs. The
      // `!isHydrated` guard above already covers the transient empty window while a
      // freshly switched workspace hydrates, so this can't fire spuriously
      // mid-switch.
      if (!activeTabId.value && tabs.value.length === 0) {
        if (route.fullPath !== "/start") router.push("/start")
        return
      }

      // During initial sync the Route→Store watcher is authoritative — don't let
      // a restored tab override a redirect URL.
      if (isInitialRouteSync) return

      // No active tab but the strip isn't empty (shouldn't normally happen) — leave
      // the route alone rather than guessing a destination.
      if (!activeTabId.value) return

      if (newPath && newPath !== route.fullPath) {
        router.push(newPath)
      }
    },
    { flush: "post" }
  )
}

export interface UseTabActionsOptions {
  /**
   * Begin inline-rename for a tab id. Owned by the component (it holds the
   * `<input>` ref + local draft refs); invoked by the `Tabs.Rename` mitt
   * handler here.
   */
  beginRename: (id: string | undefined) => void
}

export function useTabActions({ beginRename }: UseTabActionsOptions) {
  const router = useRouter()
  const route = useRoute()

  const tabsStore = useTabsStore()
  const { tabs, activeTabId } = storeToRefs(tabsStore)
  const {
    addTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    duplicateTab,
    setTabPinned,
    setActiveTab,
    reopenLastClosed,
  } = tabsStore

  function navigateToTab(tab: { fullPath: string }) {
    if (route.fullPath !== tab.fullPath) router.push(tab.fullPath)
  }

  // ----------------------------------------------------------------------------
  // Navigation entry points (bound by the tab strip menus/tooltips)
  // ----------------------------------------------------------------------------
  function onTabClick(tab: { id: string }) {
    // Snappy active-state update; the route watcher reconciles the rest.
    setActiveTab(tab.id)
  }

  async function handleAddTab(fullPath = "/new", name?: string) {
    // Reuse an existing tab for the same (non-"/new") path instead of duplicating.
    const existing = tabs.value.find(
      (tab) => tab.fullPath === fullPath && fullPath !== "/new"
    )
    if (existing) {
      setActiveTab(existing.id)
      return
    }

    const newTab = await addTab(fullPath, name)
    if (newTab) navigateToTab(newTab)
  }

  function openNewTab() {
    void handleAddTab()
  }

  function handleCloseTab(id: string | undefined) {
    if (!id) return
    const tab = tabs.value.find((entry) => entry.id === id)
    if (!tab || tab.pinned) return
    // Fire the optimistic close; the Store→Route watcher reconciles the route off
    // the resulting active-tab change (closing the last tab routes to /start via
    // the empty-strip branch, which is immune to a stalled/failed persist).
    // Swallow a persist rejection so a degraded sync backend can't leak an
    // unhandled rejection here.
    void closeTab(id).catch(() => {})
  }

  function handleDuplicateTab(id: string | undefined) {
    // duplicateTab makes the copy active; the Store→Route watcher follows it
    // (and the copy shares the source's path, so there's usually nothing to do).
    if (id) void duplicateTab(id)
  }

  async function handleToggleTabPinned(id: string | undefined) {
    if (!id) return
    const tab = tabs.value.find((entry) => entry.id === id)
    if (!tab) return
    await setTabPinned(id, !tab.pinned)
  }

  // Select a tab by id, by 1-based index, or by relative direction.
  function selectTab(idOrDirection: string | number) {
    if (tabs.value.length === 0) return

    let targetId: string | undefined

    if (idOrDirection === "next" || idOrDirection === "previous") {
      const currentIndex = tabs.value.findIndex(
        (tab) => tab.id === activeTabId.value
      )
      const start = currentIndex === -1 ? 0 : currentIndex
      const nextIndex =
        idOrDirection === "next"
          ? (start + 1) % tabs.value.length
          : (start - 1 + tabs.value.length) % tabs.value.length
      targetId = tabs.value[nextIndex]?.id
    } else if (typeof idOrDirection === "number") {
      const tabIdx = Math.max(
        0,
        Math.min(idOrDirection - 1, tabs.value.length - 1)
      )
      targetId = tabs.value[tabIdx]?.id
    } else {
      targetId = idOrDirection
    }

    if (!targetId) return
    const target = tabs.value.find((tab) => tab.id === targetId)
    if (!target) return

    // Set active explicitly: the path may not change (several "/new" tabs).
    setActiveTab(target.id)
    navigateToTab(target)
  }

  // ----------------------------------------------------------------------------
  // Global events (Mitt) — driven by hotkeys and other components
  // ----------------------------------------------------------------------------
  // An explicit string id targets that tab; anything else means the active one.
  const idOrActive = (id: unknown) =>
    (typeof id === "string" ? id : activeTabId.value) || undefined

  function onTabsAdd(raw?: unknown) {
    const data = raw as
      | { fullPath?: string; path?: string; url?: string; name?: string }
      | undefined
    const path = data?.fullPath || data?.path || data?.url || "/new"
    handleAddTab(path, data?.name).catch(() => {})
  }

  function onTabsClose(id?: unknown) {
    // ⌘W with no tab left to close (or on the last one) closes the desktop
    // window like a browser would. An explicit id is a click on one tab's
    // own close action, which only ever closes that tab.
    if (
      typeof id !== "string" &&
      isMainTauriWindow.value &&
      (!activeTabId.value || tabs.value.length === 1)
    ) {
      requestAppClose("close")
      return
    }
    handleCloseTab(idOrActive(id))
  }

  function onTabsCloseOthers(id?: unknown) {
    const keepId = idOrActive(id)
    // closeOtherTabs makes `keepId` the active tab; the Store→Route watcher follows
    // it. Swallow a persist rejection from a degraded sync backend.
    if (keepId) void closeOtherTabs(keepId).catch(() => {})
  }

  function onTabsCloseAll() {
    // Navigation is handled reactively by the Store→Route watcher: emptying the
    // strip clears the active tab and its empty-strip → /start branch redirects
    // immediately, independent of the (possibly dead-lettering) Firestore write.
    // This replaces the old `await closeAllTabs()` → router.push, which froze the
    // redirect for ~2 min behind the persist and then ran a rollback that snapped
    // the closed tabs back. Swallow a persist rejection so it can't leak.
    void closeAllTabs().catch(() => {})
  }

  function onTabsSelect(idOrIndex?: unknown) {
    if (typeof idOrIndex === "string" || typeof idOrIndex === "number") {
      selectTab(idOrIndex)
    }
  }

  function onTabsReopenLast() {
    const last = reopenLastClosed()
    if (last) handleAddTab(last.fullPath, last.name)
  }

  function onTabsReopen(raw?: unknown) {
    const tab = raw as { fullPath: string; name: string } | undefined
    if (tab) handleAddTab(tab.fullPath, tab.name)
  }

  const handlers: Record<string, (payload?: unknown) => void> = {
    "Tabs.Add": onTabsAdd,
    "Tabs.Close": onTabsClose,
    "Tabs.Close.Others": onTabsCloseOthers,
    "Tabs.Close.All": onTabsCloseAll,
    "Tabs.Select": onTabsSelect,
    "Tabs.ReopenLast": onTabsReopenLast,
    "Tabs.Reopen": onTabsReopen,
    "Tabs.Duplicate": (id) => handleDuplicateTab(idOrActive(id)),
    "Tabs.Rename": (id) => beginRename(idOrActive(id)),
  }

  onMounted(() => {
    for (const [event, handler] of Object.entries(handlers)) {
      emitter.on(event, handler)
    }
  })

  onUnmounted(() => {
    for (const [event, handler] of Object.entries(handlers)) {
      emitter.off(event, handler)
    }
  })

  return {
    onTabClick,
    openNewTab,
    handleCloseTab,
    handleDuplicateTab,
    handleToggleTabPinned,
  }
}
