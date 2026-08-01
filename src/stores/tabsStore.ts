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
 *
 * Watcher-lane persistence is split by change kind (see
 * {@link classifyTabsChange}): structural strip changes keep the fast 500ms
 * debounce, while passive pointer changes (active tab id, the active tab's
 * path refresh from navigation — the highest-volume write family in the app)
 * ride a long debounce flushed on `visibilitychange`→hidden and `pagehide`.
 * A failed lane persist arms one bounded retry (re-armed while still dirty)
 * instead of leaving the doc silently stale. Local state stays instant either
 * way.
 */

import { generateId, isDefaultRoute } from "@/helpers/utilities"
import { firestore } from "@/modules/firebase"
import { canPersistTabs, shouldMarkHydrated } from "@/stores/tabsStoreHydration"
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
import {
  tryOnScopeDispose,
  useEventListener,
  watchDebounced,
} from "@vueuse/core"
import { doc } from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"
import { useCurrentUser } from "vuefire"

export type Tab = LayoutTab

// Debounce for the STRUCTURAL "settled state → Firestore" lane. Long enough to
// collapse a burst of edits into one write, short enough to feel instant.
const PERSIST_DEBOUNCE_MS = 500

// Debounce for the POINTER lane. Every in-app navigation refreshes the active
// tab's pointer state, making it plausibly the highest-volume write family in
// the system — and each whole-doc write costs a full settlement round trip.
// Local state is instant either way and cross-device pointer sync tolerates
// seconds of lag, so coalesce hard and rely on the hidden/pagehide flush for
// the tail write.
const POINTER_PERSIST_DEBOUNCE_MS = 15_000
// Ceiling for continuous navigation: without it, a user who never pauses for
// the full debounce window would defer the pointer write indefinitely.
const POINTER_PERSIST_MAX_WAIT_MS = 60_000
// Delay for the single bounded re-attempt after a watcher-lane persist
// rejection (see `armPersistRetry` in the store below).
const PERSIST_RETRY_DELAY_MS = 30_000

/** The exact shape `persistTabs` writes (and a snapshot application yields). */
export type PersistedTabsState = {
  tabs: Tab[]
  active: string
  recentlyClosed: Tab[]
}

export type TabsPersistChangeKind = "none" | "pointer" | "structural"

const sameTabIdentity = (a: Tab, b: Tab): boolean =>
  a.id === b.id && Boolean(a.pinned) === Boolean(b.pinned)

const sameClosedEntry = (a: Tab, b: Tab): boolean =>
  a.id === b.id &&
  a.name === b.name &&
  a.fullPath === b.fullPath &&
  Boolean(a.pinned) === Boolean(b.pinned)

/**
 * Classify the delta between two persisted shapes for the split watcher lanes.
 * Pure — exported for tests.
 *
 * - `structural`: the strip itself changed — a tab added/removed/reordered, a
 *   pin toggled, or the recently-closed history edited. Rides the fast
 *   {@link PERSIST_DEBOUNCE_MS} lane.
 * - `pointer`: only passive cursor state moved — the active tab id, or an
 *   existing tab's path/name refresh as navigation consumes it, with the tab
 *   set otherwise identical. Rides the long
 *   {@link POINTER_PERSIST_DEBOUNCE_MS} lane.
 * - `none`: shapes match, nothing to persist. This is also what kills the
 *   write echo: applying a remote snapshot refreshes the lane baseline, so
 *   the lane timers that application triggers classify `none` and skip.
 */
export function classifyTabsChange(
  previous: PersistedTabsState,
  next: PersistedTabsState
): TabsPersistChangeKind {
  if (
    previous.recentlyClosed.length !== next.recentlyClosed.length ||
    previous.recentlyClosed.some((entry, i) => {
      const other = next.recentlyClosed[i]
      return !other || !sameClosedEntry(entry, other)
    })
  ) {
    return "structural"
  }

  if (previous.tabs.length !== next.tabs.length) return "structural"

  let pointerChanged = previous.active !== next.active
  for (let i = 0; i < previous.tabs.length; i++) {
    const prevTab = previous.tabs[i]
    const nextTab = next.tabs[i]
    if (!prevTab || !nextTab || !sameTabIdentity(prevTab, nextTab)) {
      return "structural"
    }
    if (
      prevTab.fullPath !== nextTab.fullPath ||
      prevTab.name !== nextTab.name
    ) {
      pointerChanged = true
    }
  }

  return pointerChanged ? "pointer" : "none"
}

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

  // Doc path of the last successful read this session (reset on team/workspace
  // switch). Latched by the hydration gate below and required by the persist
  // guard, so persistence stays unlocked across mid-session refetch windows
  // (where `isHydrated` drops back to false) but never opens before one
  // successful read of the doc it would overwrite.
  const confirmedReadPath = ref<string | null>(null)

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

  const {
    data: tabsDocData,
    isLoading: tabsPending,
    isError: tabsReadFailed,
    error: tabsReadError,
  } = useDocumentQuery(tabsDocRef)

  const isLoading = computed(() => tabsPending.value && !isHydrated.value)

  // Terminal tabs read failure, exposed so UI can surface a retry. Recovery
  // lands via normal query invalidation/refetch flipping the hydration gate
  // back on; nothing here needs to be re-armed manually.
  const hydrationError = computed(() =>
    tabsReadFailed.value ? tabsReadError.value : null
  )

  // ==========================================================================
  // Persistence helpers (function declarations: hoisted so the watchers and
  // the debounced sync below can reference them before this point in source).
  // ==========================================================================

  // Last server-confirmed shape: the most recent applied snapshot, or the
  // payload of the most recent successful persist. The watcher lanes classify
  // live state against this baseline, so a persist from ANY path (lane, flush,
  // retry, or a `runWrite` action) marks the covered delta clean — no lane
  // re-writes what another path already persisted, and applying a remote
  // snapshot never echoes an identical doc back out. Not reactive on purpose:
  // pure bookkeeping, and every mutation replaces (never mutates) the arrays
  // it holds.
  let persistedBaseline: PersistedTabsState = {
    tabs: [],
    active: "",
    recentlyClosed: [],
  }

  function currentPersistShape(): PersistedTabsState {
    return {
      tabs: tabs.value,
      active: activeTabId.value,
      recentlyClosed: recentlyClosed.value,
    }
  }

  function persistTabs(): Promise<boolean> {
    // Structural guard at the one whole-doc write seam: this payload replaces
    // the saved `tabs`/`recentlyClosed` arrays wholesale (merge:true only
    // merges maps), so it must never run before a successful read of the doc
    // it targets — after a terminal read error the local strip is empty, and a
    // single navigation would silently wipe the user's saved tabs
    // cross-device. Local tab mutations made while blocked stay local and may
    // be overwritten when real hydration arrives — acceptable.
    if (
      !canPersistTabs({
        targetPath: tabsDocRef.value?.path ?? null,
        confirmedReadPath: confirmedReadPath.value,
      })
    ) {
      return Promise.resolve(false)
    }
    // Capture the payload so a success promotes exactly what was written to
    // the lane baseline — live state may move again while the write is in
    // flight, and that residue must keep classifying as dirty.
    const payload = currentPersistShape()
    return safeSetDoc(tabsDocRef.value, payload, "layout.tabs.persist").then(
      (persisted) => {
        if (persisted) persistedBaseline = payload
        return persisted
      }
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

  // Team/workspace change → pause sync and clear local tabs until the new
  // workspace's snapshot lands. The `oldId !== undefined` guard skips the
  // initial resolution (when both go from undefined to a value).
  //
  // REGISTERED BEFORE the tabs-doc application watcher on purpose: watchers
  // flush in creation order, and a cache-warm switch delivers the new
  // workspace's CACHED doc in the same flush as the id flip. Wipe-then-apply
  // leaves the strip correctly populated; the reverse order applies the doc
  // first and then wipes it — and because the live refetch resolves
  // deep-equal to the cache (structural sharing keeps the same reference),
  // the application watcher never re-fires, leaving an empty strip that the
  // open persist gate could later write over the server doc.
  watch(
    [() => currentTeam.value?.id, () => currentWorkspace.value?.id],
    ([newTeamId, newWorkspaceId], [oldTeamId, oldWorkspaceId]) => {
      const teamChanged = newTeamId !== oldTeamId && oldTeamId !== undefined
      const workspaceChanged =
        newWorkspaceId !== oldWorkspaceId && oldWorkspaceId !== undefined
      if (!teamChanged && !workspaceChanged) return

      isHydrated.value = false
      confirmedReadPath.value = null
      tabs.value = []
      activeTabId.value = ""
      recentlyClosed.value = []
      tabIndicators.value = {}
      // The lanes target a different doc now: drop any armed failure retry and
      // re-seed the baseline at the cleared state. Un-persisted dirt from the
      // outgoing workspace is abandoned (same semantics as a rollback).
      cancelPersistRetry()
      persistedBaseline = currentPersistShape()
    }
  )

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
        persistedBaseline = currentPersistShape()
        return
      }

      const tabsDoc = asTabsDoc(snapshot)
      tabs.value = normalizeTabs(tabsDoc?.tabs ?? [])
      activeTabId.value = tabsDoc?.active ?? ""
      recentlyClosed.value = normalizeTabHistory(tabsDoc?.recentlyClosed ?? [])
      pruneTabIndicators(tabs.value)
      // The applied snapshot IS the server state — refresh the lane baseline
      // so the persistence watchers this application triggers classify `none`
      // instead of echoing the identical doc back out.
      persistedBaseline = currentPersistShape()
    },
    { immediate: true }
  )

  // Hydration gate: hydrated only after a SUCCESSFUL read for the current tabs
  // ref — the doc's data landed, or the listener confirmed it absent. A
  // terminal read error also ends with `tabsPending === false` (and `data`
  // still undefined), so "no longer pending" alone must never be the signal.
  // Re-enters hydration mode while the query refreshes; `confirmedReadPath`
  // latches the first success so persistence stays unlocked across those
  // windows.
  watch(
    [tabsDocRef, tabsDocData, tabsPending, tabsReadFailed],
    ([tabsRef, snapshot, tp, readFailed]) => {
      const hydrated = shouldMarkHydrated({
        hasRef: Boolean(tabsRef),
        hasData: snapshot !== undefined && snapshot !== null,
        confirmedAbsent: snapshot === null,
        isError: readFailed,
        isPending: tp,
      })
      isHydrated.value = hydrated
      if (hydrated && tabsRef) confirmedReadPath.value = tabsRef.path
    },
    { immediate: true }
  )

  // ==========================================================================
  // Persistence watchers (debounced: settled local state → Firestore, split
  // into a fast structural lane and a long pointer lane by classifying the
  // live state against `persistedBaseline`)
  // ==========================================================================

  // Shared lane gate: an in-flight `runWrite` op owns persistence right now,
  // and nothing may write before hydration (P0 persist guard).
  function canRunPersistLane(): boolean {
    if (pendingTabIds.value.size > 0) return false
    if (!tabsDocRef.value || tabsPending.value || !isHydrated.value)
      return false
    return true
  }

  // Single bounded re-attempt after a lane persist failure (see
  // `armPersistRetry`). A raw timer instead of another debounced watcher: it
  // must fire with NO further state changes — the exact case the watcher lanes
  // can never cover.
  let persistRetryTimer: ReturnType<typeof setTimeout> | null = null

  function cancelPersistRetry() {
    if (persistRetryTimer) {
      clearTimeout(persistRetryTimer)
      persistRetryTimer = null
    }
  }

  // Arm ONE pending retry after `PERSIST_RETRY_DELAY_MS`. Re-armed by the next
  // failure while still dirty — a spaced ladder, never a tight loop — and
  // superseded whenever a lane/flush dispatch takes over (mirrors the snapshot
  // manager's retry scheduler in `utils/collab/snapshots.ts`). At fire time it
  // re-checks the gate and the classification: a runWrite op in flight or a
  // closed persist guard drops the retry (hydration re-seeds the baseline
  // anyway), and a clean baseline ends the ladder.
  function armPersistRetry() {
    if (persistRetryTimer) return
    persistRetryTimer = setTimeout(() => {
      persistRetryTimer = null
      if (!canRunPersistLane()) return
      if (
        classifyTabsChange(persistedBaseline, currentPersistShape()) === "none"
      ) {
        return
      }
      dispatchLanePersist()
    }, PERSIST_RETRY_DELAY_MS)
  }

  // The one watcher-lane write path: this dispatch owns the retry decision, so
  // any armed retry is superseded first. `safeSetDoc` resolves `false` (and
  // reports through the sync engine's normal telemetry) on failure — the lane
  // reacts by arming the bounded retry instead of leaving the doc stale.
  // `runWrite` actions do NOT route through here: their failure path rolls
  // local state back to the baseline, so there is nothing left to retry.
  function dispatchLanePersist() {
    cancelPersistRetry()
    void persistTabs().then((persisted) => {
      if (!persisted) armPersistRetry()
    })
  }

  // Immediate tail write for the pointer lane (also exposed on the store):
  // fired on `visibilitychange`→hidden and `pagehide` so a long-debounced
  // pointer move can't be lost to a tab switch or window close.
  function flushTabsPersist() {
    if (!canRunPersistLane()) return
    if (
      classifyTabsChange(persistedBaseline, currentPersistShape()) === "none"
    ) {
      return
    }
    dispatchLanePersist()
  }

  // STRUCTURAL lane: the strip itself changed — persist fast. No `deep` —
  // every mutation reassigns the array or replaces tab objects, so top-level
  // reactivity is enough (and a deep walk would fire on every route navigation
  // via `updateActiveTab`). A structural persist inherently flushes the
  // pointer lane: the payload carries the newest pointer state (persists
  // always write live state, so ordering can never invert) and refreshes the
  // baseline, so a pending pointer timer classifies `none` and skips.
  watchDebounced(
    [tabs, activeTabId, recentlyClosed],
    () => {
      if (!canRunPersistLane()) return
      if (
        classifyTabsChange(persistedBaseline, currentPersistShape()) !==
        "structural"
      ) {
        return
      }
      dispatchLanePersist()
    },
    { debounce: PERSIST_DEBOUNCE_MS }
  )

  // POINTER lane: only passive cursor state moved — coalesce hard, with a
  // maxWait ceiling so continuous navigation still checkpoints. Persists on
  // any non-`none` delta (not just `pointer`): if a structural persist failed
  // and left the baseline stale, this lane's write covers it too — the payload
  // is always the whole live doc.
  watchDebounced(
    [tabs, activeTabId, recentlyClosed],
    () => {
      if (!canRunPersistLane()) return
      if (
        classifyTabsChange(persistedBaseline, currentPersistShape()) === "none"
      ) {
        return
      }
      dispatchLanePersist()
    },
    {
      debounce: POINTER_PERSIST_DEBOUNCE_MS,
      maxWait: POINTER_PERSIST_MAX_WAIT_MS,
    }
  )

  // Tail-write triggers (guarded: absent in the node test environment).
  if (typeof document !== "undefined") {
    useEventListener(document, "visibilitychange", () => {
      if (document.visibilityState === "hidden") flushTabsPersist()
    })
  }
  if (typeof window !== "undefined") {
    useEventListener(window, "pagehide", () => flushTabsPersist())
  }

  // Store teardown (tests, HMR): nothing should fire after the scope is gone.
  tryOnScopeDispose(cancelPersistRetry)

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
    hydrationError,

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
    flushTabsPersist,
  }
})
