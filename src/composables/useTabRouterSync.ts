/**
 * Route ⇄ tab-strip synchronization for Tabbar.vue — the densest, most
 * load-bearing logic in the strip, lifted verbatim out of the component so the
 * view shrinks to presentation. {@link useTabsStore} stays the source of truth;
 * this composable only wires the URL to it and back.
 *
 * Three watchers keep the URL and the store in agreement:
 *   1. Route → Store (primary): the URL is authoritative; every change
 *      activates an existing tab, consumes a throwaway "/new", reuses the
 *      active tab for in-app navigation, restores the last session, or finally
 *      opens a fresh tab.
 *   2. Store → Route (secondary): when the active tab's path changes, follow it.
 *   3. Workspace switch: re-enter the per-workspace initial-sync phase and
 *      remember the outgoing route so (1) can ignore it until hydration lands.
 *
 * Plus the navigation entry points the menus bind to and the `Tabs.*` mitt
 * bridge (hotkeys + cross-component commands). Inline rename stays in the
 * component (it owns the input ref + local draft state); we reach it through
 * the injected {@link UseTabRouterSyncOptions.beginRename} callback.
 */
import { resolveRouteName } from "@/helpers/breadcrumber"
import { emitter } from "@/modules/mitt"
import { useTabsStore } from "@/stores/tabsStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { storeToRefs } from "pinia"
import { onMounted, onUnmounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"

export interface UseTabRouterSyncOptions {
  /**
   * Begin inline-rename for a tab id. Owned by the component (it holds the
   * `<input>` ref + local draft refs); invoked by the `Tabs.Rename` mitt
   * handler here.
   */
  beginRename: (id: string | undefined) => void
}

export function useTabRouterSync({ beginRename }: UseTabRouterSyncOptions) {
  const router = useRouter()
  const route = useRoute()

  const tabsStore = useTabsStore()
  const { tabs, activeTabId, activeTab, isHydrated } = storeToRefs(tabsStore)
  const {
    addTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    duplicateTab,
    setTabPinned,
    setActiveTab,
    updateActiveTab,
    reopenLastClosed,
  } = tabsStore

  const { currentWorkspace } = storeToRefs(useWorkspaceStore())

  // Route↔store sync bookkeeping (see watchers below).
  const isInitialRouteSync = ref(true)
  const previousWorkspaceRoutePath = ref<string | null>(null)

  function navigateToTab(tab: { fullPath: string }) {
    if (route.fullPath !== tab.fullPath) {
      router.push(tab.fullPath)
    }
  }

  // ----------------------------------------------------------------------------
  // Core synchronization: Route → Store (primary truth)
  //
  // When the URL changes, reflect it in the store — activating an existing tab,
  // consuming a throwaway "/new" tab, reusing the active tab for in-app
  // navigation, restoring the last session, or finally adding a new tab.
  // ----------------------------------------------------------------------------
  watch(
    [() => route.fullPath, isHydrated],
    async ([newPath, hydrated]) => {
      if (!hydrated || !currentWorkspace.value) return

      // Drop the workspace-switch marker once the route leaves the old path.
      if (
        previousWorkspaceRoutePath.value &&
        newPath !== previousWorkspaceRoutePath.value
      ) {
        previousWorkspaceRoutePath.value = null
      }

      // While switching workspace, don't materialize the *old* workspace's route
      // as a tab in the new one — redirect to a sensible fallback instead.
      if (
        previousWorkspaceRoutePath.value &&
        newPath === previousWorkspaceRoutePath.value
      ) {
        const fallbackPath =
          activeTab.value?.fullPath ?? tabs.value[0]?.fullPath ?? "/start"
        if (fallbackPath !== newPath) {
          router.replace(fallbackPath)
          return
        }
        // The same route can legitimately exist in both workspaces.
        previousWorkspaceRoutePath.value = null
      }

      // Already the active tab → nothing to do. Lets several "/new" tabs coexist
      // without snapping back to the first one.
      if (activeTab.value?.fullPath === newPath) {
        isInitialRouteSync.value = false
        return
      }

      // Case A: route matches an existing tab (excluding the reusable "/new").
      const existingTab = tabs.value.find((tab) => tab.fullPath === newPath)
      if (existingTab && newPath !== "/new") {
        if (activeTabId.value !== existingTab.id) setActiveTab(existingTab.id)
        isInitialRouteSync.value = false
        return
      }

      // Case B: the active tab is a throwaway "/new" → consume it for this route.
      if (activeTab.value?.fullPath === "/new") {
        updateActiveTab(newPath, resolveRouteName(route))
        isInitialRouteSync.value = false
        return
      }

      // Case C: in-app navigation → reuse the active tab (never on initial sync,
      // never for "/start").
      if (
        !isInitialRouteSync.value &&
        activeTabId.value &&
        newPath !== "/start"
      ) {
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

      isInitialRouteSync.value = false
    },
    { immediate: true }
  )

  // ----------------------------------------------------------------------------
  // Store → Route (secondary truth): when the active tab's path changes, follow.
  // ----------------------------------------------------------------------------
  watch(
    () => activeTab.value?.fullPath,
    (newPath) => {
      if (!isHydrated.value) return
      // During initial sync the Route→Store watcher is authoritative — don't let
      // a restored tab override a redirect URL.
      if (isInitialRouteSync.value) return

      if (!activeTabId.value) {
        if (route.fullPath !== "/start" && tabs.value.length === 0) {
          router.push("/start")
        }
        return
      }

      if (newPath && newPath !== route.fullPath) {
        router.push(newPath)
      }
    },
    { flush: "post" }
  )

  // ----------------------------------------------------------------------------
  // Workspace switch: re-enter the per-workspace initial-sync phase and remember
  // the outgoing route so the Route→Store watcher can ignore it once hydrated.
  // ----------------------------------------------------------------------------
  watch(
    () => currentWorkspace.value?.id,
    (newId, oldId) => {
      if (newId === oldId) return
      isInitialRouteSync.value = true
      previousWorkspaceRoutePath.value =
        oldId !== undefined ? route.fullPath : null
    }
  )

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

  async function handleCloseTab(id: string | undefined) {
    if (!id) return
    const tab = tabs.value.find((entry) => entry.id === id)
    if (!tab || tab.pinned) return
    // closeTab computes the next active tab/path; push it for instant feedback.
    const result = await closeTab(id)
    if (result?.nextPath) router.push(result.nextPath)
  }

  async function handleDuplicateTab(id: string | undefined) {
    if (!id) return
    await duplicateTab(id)
    // duplicateTab sets the copy active; navigate to it if it's a new tab.
    const newTab = tabs.value.find((tab) => tab.id === activeTabId.value)
    if (newTab && newTab.id !== id) navigateToTab(newTab)
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

    // Keep active state in sync even when the path doesn't change (e.g. several
    // tabs pointing at "/new").
    if (activeTabId.value !== target.id) setActiveTab(target.id)
    navigateToTab(target)
  }

  // ----------------------------------------------------------------------------
  // Global events (Mitt) — driven by hotkeys and other components
  // ----------------------------------------------------------------------------
  function onTabsAdd(raw?: unknown) {
    const data = raw as
      | { fullPath?: string; path?: string; url?: string; name?: string }
      | undefined
    const path = data?.fullPath || data?.path || data?.url || "/new"
    handleAddTab(path, data?.name).catch(() => {})
  }

  function onTabsClose(id?: unknown) {
    handleCloseTab(
      (typeof id === "string" ? id : activeTabId.value) || undefined
    )
  }

  function onTabsCloseOthers(id?: unknown) {
    const keepId = typeof id === "string" ? id : activeTabId.value
    if (keepId) closeOtherTabs(keepId)
  }

  async function onTabsCloseAll() {
    await closeAllTabs()
    const nextPath = activeTab.value?.fullPath
    if (nextPath && nextPath !== route.fullPath) {
      router.push(nextPath)
      return
    }
    if (!activeTabId.value && route.fullPath !== "/start") {
      router.push("/start")
    }
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

  function onTabsDuplicate(id?: unknown) {
    handleDuplicateTab(
      (typeof id === "string" ? id : activeTabId.value) || undefined
    )
  }

  function onTabsRename(id?: unknown) {
    beginRename((typeof id === "string" ? id : activeTabId.value) || undefined)
  }

  onMounted(() => {
    emitter.on("Tabs.Add", onTabsAdd)
    emitter.on("Tabs.Close", onTabsClose)
    emitter.on("Tabs.Close.Others", onTabsCloseOthers)
    emitter.on("Tabs.Close.All", onTabsCloseAll)
    emitter.on("Tabs.Select", onTabsSelect)
    emitter.on("Tabs.ReopenLast", onTabsReopenLast)
    emitter.on("Tabs.Reopen", onTabsReopen)
    emitter.on("Tabs.Duplicate", onTabsDuplicate)
    emitter.on("Tabs.Rename", onTabsRename)
  })

  onUnmounted(() => {
    emitter.off("Tabs.Add", onTabsAdd)
    emitter.off("Tabs.Close", onTabsClose)
    emitter.off("Tabs.Close.Others", onTabsCloseOthers)
    emitter.off("Tabs.Close.All", onTabsCloseAll)
    emitter.off("Tabs.Select", onTabsSelect)
    emitter.off("Tabs.ReopenLast", onTabsReopenLast)
    emitter.off("Tabs.Reopen", onTabsReopen)
    emitter.off("Tabs.Duplicate", onTabsDuplicate)
    emitter.off("Tabs.Rename", onTabsRename)
  })

  return {
    onTabClick,
    openNewTab,
    handleCloseTab,
    handleDuplicateTab,
    handleToggleTabPinned,
  }
}
