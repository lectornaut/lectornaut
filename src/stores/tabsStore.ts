/**
 * Tabs Store
 * ==========
 *
 * Owns the open/active/recently-closed tab strip plus per-tab indicators.
 * Scoped to the active workspace at
 * `teams/{team}/memberships/{uid}/workspaces/{ws}/layout/tabs`, so switching
 * workspace swaps the whole strip.
 *
 * Writes are optimistic via the shared `runWrite` seam: local state changes
 * immediately, the Firestore write is queued through the sync engine, and a
 * failure rolls the local state back. Reads come through TanStack-backed
 * `useDocumentQuery`, which surfaces three states we depend on: `undefined`
 * (loading), `null` (confirmed-absent), or the parsed document.
 * Snapshot-application is gated by `pendingTabIds` so an in-flight optimistic
 * edit is never clobbered by an interim server tick.
 */

import { generateId, isDefaultRoute } from "@/helpers/utilities"
import { firestore } from "@/modules/firebase"
import { useTeamStore } from "@/stores/teamStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import type {
  LayoutTab,
  LayoutTabIndicator,
  LayoutTabsDoc,
} from "@/types/layout"
import { useRunWrite } from "@/utils/firebase/firebase-mutation"
import {
  cloneState,
  createPendingSet,
} from "@/utils/firebase/firebase-optimistic"
import { useDocumentQuery } from "@/utils/firebase/firebase-query"
import { safeSetDocument as safeSetDoc } from "@/utils/firebase/firebase-sync-engine"
import { watchDebounced } from "@vueuse/core"
import { doc } from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"
import { useCurrentUser } from "vuefire"

export type Tab = LayoutTab

// Debounce for every "settled state → Firestore" watcher. Long enough to
// collapse a burst of edits into one write, short enough to feel instant.
const PERSIST_DEBOUNCE_MS = 500

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const asTabsDoc = (value: unknown): LayoutTabsDoc | null =>
  isRecord(value) ? (value as LayoutTabsDoc) : null

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

export const useTabsStore = defineStore("tabs", () => {
  const user = useCurrentUser()
  const { currentTeam } = storeToRefs(useTeamStore())
  const { currentWorkspace } = storeToRefs(useWorkspaceStore())

  // ==========================================================================
  // State
  // ==========================================================================

  // Tabs lane (Firestore-authoritative, hydrated per workspace).
  const tabs = ref<Tab[]>([])
  const activeTabId = ref("")
  const recentlyClosed = ref<Tab[]>([])
  const tabIndicators = ref<Record<string, LayoutTabIndicator>>({})

  const isHydrated = ref(false)

  // Pending-operation tracking. While a tab id sits in `pendingTabIds`, inbound
  // snapshots for the tabs doc are ignored so the optimistic edit survives.
  const pendingTabIds = shallowRef(createPendingSet())
  // Optimism targets local `tabs` state guarded by the `pendingTabIds` watch
  // (not a held cache key), so `runWrite` is called with `keys: []`.
  const runWrite = useRunWrite("layout.tabs")

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

  // ==========================================================================
  // Reads (TanStack Query, realtime)
  // ==========================================================================

  const { data: tabsDocData, isLoading: tabsPending } =
    useDocumentQuery(tabsDocRef)

  const isLoading = computed(() => tabsPending.value && !isHydrated.value)

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

  // Hydration gate: hydrated only once we have a valid tabs ref AND the tabs
  // doc is no longer pending. Re-enters hydration mode while it refreshes.
  watch(
    [tabsPending, tabsDocRef],
    ([tp, tabsRef]) => {
      if (!tabsRef || tp) {
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

    await runWrite({
      keys: [],
      apply: () => {
        tabs.value = normalizeTabs([...tabs.value, newTab])
        activeTabId.value = newTab.id
      },
      rollback: () => {
        tabs.value = previousTabs
        activeTabId.value = previousActiveTabId
      },
      fn: async () => {
        if (!(await persistTabs())) throw new Error("Failed to persist tab")
      },
      pending: { ref: pendingTabIds, ids: [newTab.id] },
    })

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

    await runWrite({
      keys: [],
      apply: () => {
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
      rollback: () => {
        tabs.value = previousTabs
        activeTabId.value = previousActiveTabId
        recentlyClosed.value = previousRecentlyClosed
        tabIndicators.value = previousTabIndicators
      },
      fn: async () => {
        if (!(await persistTabs())) {
          throw new Error("Failed to persist tab close")
        }
      },
      pending: { ref: pendingTabIds, ids: [id] },
    })

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

    await runWrite({
      keys: [],
      apply: () => {
        tabsToClose.forEach(addToHistory)
        const remaining = normalizeTabs(
          tabs.value.filter((tab) => tab.pinned || tab.id === keepId)
        )
        tabs.value = remaining
        activeTabId.value = keep.id
        pruneTabIndicators(remaining)
      },
      rollback: () => {
        tabs.value = previousTabs
        activeTabId.value = previousActiveTabId
        recentlyClosed.value = previousRecentlyClosed
        tabIndicators.value = previousTabIndicators
      },
      fn: async () => {
        if (!(await persistTabs())) {
          throw new Error("Failed to persist closeOtherTabs")
        }
      },
      pending: { ref: pendingTabIds, ids: tabsToClose.map((tab) => tab.id) },
      source: "layout.tabs.closeOther",
    })
  }

  async function closeAllTabs(): Promise<void> {
    const tabsToClose = tabs.value.filter((tab) => !tab.pinned)
    if (tabsToClose.length === 0) return

    const previousTabs = cloneState(tabs.value)
    const previousActiveTabId = activeTabId.value
    const previousRecentlyClosed = cloneState(recentlyClosed.value)
    const previousTabIndicators = cloneState(tabIndicators.value)

    await runWrite({
      keys: [],
      apply: () => {
        tabsToClose.forEach(addToHistory)
        const remaining = normalizeTabs(tabs.value.filter((tab) => tab.pinned))
        const stillActive = remaining.find(
          (tab) => tab.id === activeTabId.value
        )
        tabs.value = remaining
        activeTabId.value = stillActive?.id ?? remaining[0]?.id ?? ""
        pruneTabIndicators(remaining)
      },
      rollback: () => {
        tabs.value = previousTabs
        activeTabId.value = previousActiveTabId
        recentlyClosed.value = previousRecentlyClosed
        tabIndicators.value = previousTabIndicators
      },
      fn: async () => {
        if (!(await persistTabs())) {
          throw new Error("Failed to persist closeAllTabs")
        }
      },
      pending: { ref: pendingTabIds, ids: tabsToClose.map((tab) => tab.id) },
      source: "layout.tabs.closeAll",
    })
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

    await runWrite({
      keys: [],
      apply: () => {
        tabs.value = normalizeTabs([...tabs.value, duplicate])
        activeTabId.value = duplicate.id
      },
      rollback: () => {
        tabs.value = previousTabs
        activeTabId.value = previousActiveTabId
      },
      fn: async () => {
        if (!(await persistTabs())) {
          throw new Error("Failed to persist duplicateTab")
        }
      },
      pending: { ref: pendingTabIds, ids: [duplicate.id] },
    })
  }

  async function renameTab(id: string, newName: string): Promise<void> {
    const tab = tabs.value.find((entry) => entry.id === id)
    if (!tab || isDefaultRoute(tab)) return
    const trimmed = newName.trim()
    if (!trimmed) return

    const previousTabs = cloneState(tabs.value)

    await runWrite({
      keys: [],
      apply: () => {
        tabs.value = tabs.value.map((entry) =>
          entry.id === id ? { ...entry, name: trimmed } : entry
        )
      },
      rollback: () => {
        tabs.value = previousTabs
      },
      fn: async () => {
        if (!(await persistTabs())) {
          throw new Error("Failed to persist renameTab")
        }
      },
      pending: { ref: pendingTabIds, ids: [id] },
    })
  }

  async function setTabPinned(id: string, pinned: boolean): Promise<void> {
    const tab = tabs.value.find((entry) => entry.id === id)
    if (!tab || tab.pinned === pinned) return

    const previousTabs = cloneState(tabs.value)

    await runWrite({
      keys: [],
      apply: () => {
        tabs.value = normalizeTabs(
          tabs.value.map((entry) =>
            entry.id === id ? { ...entry, pinned } : entry
          )
        )
      },
      rollback: () => {
        tabs.value = previousTabs
      },
      fn: async () => {
        if (!(await persistTabs())) {
          throw new Error("Failed to persist setTabPinned")
        }
      },
      pending: { ref: pendingTabIds, ids: [id] },
    })
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

  return {
    // State
    tabs,
    activeTabId,
    activeTab,
    recentlyClosed,
    tabIndicators,
    isLoading,
    isHydrated,

    // Pending state
    pendingTabIds,
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
    addToHistory,
    clearRecentlyClosed,
    reopenLastClosed,
    normalizeTabOrder,
  }
})
