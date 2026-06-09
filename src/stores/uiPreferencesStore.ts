/**
 * UI Preferences Store
 * ====================
 *
 * Owns the per-user layout UI preferences: sidebar open/pinned state, the
 * left/right/bottom panel collapse flags, the Agents-section visibility, and
 * the per-agent visibility map.
 *
 * Each flag writes to localStorage instantly (optimistic, offline-safe) via
 * `useStorage`, and is mirrored into the per-user `users/{uid}/layout/navigation`
 * document's `ui`/`agentVisibility` subfields for cross-device sync. That doc is
 * shared with `useNavigationStore` (which owns the `visibleItems`/`order`
 * subfields): `safeSetDocument` merges, so the two stores never clobber each
 * other, and the realtime read is de-duplicated by TanStack Query (one listener
 * per doc path) even though both stores call `useDocumentQuery` on it.
 *
 * Persistence is debounced through `createDebouncedCloudSync` (passive toggles,
 * not the optimistic `runWrite` seam): a burst of toggles collapses into one
 * write, and snapshot application is gated by a dirty flag so a stale remote
 * doc can't revert a fresh local edit.
 */

import { firestore } from "@/modules/firebase"
import type { LayoutNavigationDoc, NavigationUiState } from "@/types/layout"
import { createDebouncedCloudSync } from "@/utils/firebase/firebase-optimistic"
import { useDocumentQuery } from "@/utils/firebase/firebase-query"
import { safeSetDocument as safeSetDoc } from "@/utils/firebase/firebase-sync-engine"
import { useStorage, watchDebounced } from "@vueuse/core"
import { doc } from "firebase/firestore"
import { defineStore } from "pinia"
import { useCurrentUser } from "vuefire"

// Debounce for the "settled state → Firestore" watcher. Long enough to collapse
// a burst of toggles into one write, short enough to feel instant.
const PERSIST_DEBOUNCE_MS = 500

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const asNavigationDoc = (value: unknown): LayoutNavigationDoc | null =>
  isRecord(value) ? (value as LayoutNavigationDoc) : null

export const useUiPreferencesStore = defineStore("uiPreferences", () => {
  const user = useCurrentUser()

  // ==========================================================================
  // State
  // ==========================================================================

  // Each flag writes to localStorage instantly (optimistic, offline-safe) and is
  // mirrored into the per-user `navigation.ui` doc for cross-device sync. Keys
  // are stable contracts — never rename them.
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

  // Set while we copy a remote `navigation.ui` snapshot into the local refs, so
  // the "mark dirty" watcher can tell our own apply apart from a user toggle.
  const isApplyingNavigationUiSnapshot = shallowRef(false)
  // True once a UI pref changed locally and hasn't round-tripped to Firestore.
  // Gates snapshot application so a stale remote doc can't revert a fresh edit.
  const navigationUiDirty = ref(false)

  // ==========================================================================
  // Snapshot helpers
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

  // Toggle a single agent's visibility. Writes an explicit boolean (never
  // deletes the key) so re-showing an agent overrides a remote `false` under
  // Firestore merge semantics. Persistence rides the debounced UI-prefs watcher.
  function setAgentVisible(agentId: string, visible: boolean): void {
    if (isAgentVisible(agentId) === visible) return
    agentVisibility.value = { ...agentVisibility.value, [agentId]: visible }
  }

  // ==========================================================================
  // Firestore document ref + read
  // ==========================================================================

  const navigationDocRef = computed(() => {
    const uid = user.value?.uid
    if (!uid) return null
    return doc(firestore, "users", uid, "layout", "navigation")
  })

  // Realtime read of the shared navigation doc. We consume only the
  // `ui`/`agentVisibility` subfields; `useNavigationStore` consumes the
  // `visibleItems`/`order` subfields off the same (de-duplicated) listener.
  const { data: navDocData } = useDocumentQuery(navigationDocRef)

  // ==========================================================================
  // Persistence
  // ==========================================================================

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

  const { trigger: persistNavigationUiWithSync, pending: pendingNavigationUi } =
    createDebouncedCloudSync({
      persist: persistNavigationUiState,
      id: "navigation-ui",
      source: "layout.navigation.ui.persist",
      canPersist: () => navigationDocRef.value !== null,
      errorLabel: "layout.navigationUi",
    })

  // ==========================================================================
  // Watchers
  // ==========================================================================

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

  // Navigation doc → UI prefs. Reads only the `ui`/`agentVisibility` subfields;
  // the `visibleItems`/`order` nav-items subfields are owned by
  // `useNavigationStore`, which observes the same de-duplicated doc query.
  watch(
    navDocData,
    (snapshot) => {
      // Loading window — don't apply before the real doc arrives.
      if (snapshot === undefined) return

      const navigationDoc = asNavigationDoc(snapshot)
      // Confirmed-absent (or non-object) doc: keep the localStorage-backed prefs.
      if (!navigationDoc) return

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
    },
    { immediate: true }
  )

  // UI prefs → Firestore. Only persists when a local change actually marked
  // things dirty.
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

  return {
    // State
    sidebarOpen,
    sidebarPinned,
    leftPanelCollapsed,
    rightPanelCollapsed,
    bottomPanelCollapsed,
    agentsSidebarVisible,
    agentVisibility,

    // Actions
    isAgentVisible,
    setAgentVisible,
  }
})
