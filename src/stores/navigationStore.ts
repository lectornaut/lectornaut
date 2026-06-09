/**
 * Navigation Store
 * ================
 *
 * Owns the per-user sidebar navigation items — which entries from `defaultMenu`
 * are visible and in what order. Backed by the `visibleItems`/`order` subfields
 * of the per-user `users/{uid}/layout/navigation` document, so the nav order
 * follows the user across workspaces and devices.
 *
 * The `ui`/`agentVisibility` subfields of the same doc are owned by
 * `useUiPreferencesStore`; `safeSetDocument` merges, so the two stores write
 * disjoint fields without clobbering each other, and the realtime read is
 * de-duplicated by TanStack Query (one listener per doc path) even though both
 * stores call `useDocumentQuery` on it.
 *
 * Writes are optimistic and single-flight: `pendingNavigation` gates snapshot
 * application while a mutation is in flight, and a failure rolls `activeNavItems`
 * back. Reads come through TanStack-backed `useDocumentQuery`.
 */

import { defaultMenu } from "@/helpers/defaults"
import { firestore } from "@/modules/firebase"
import type { LayoutNavigationDoc } from "@/types/layout"
import {
  cloneState,
  withCloudSyncOperation,
} from "@/utils/firebase/firebase-optimistic"
import { useDocumentQuery } from "@/utils/firebase/firebase-query"
import { safeSetDocument as safeSetDoc } from "@/utils/firebase/firebase-sync-engine"
import { watchDebounced } from "@vueuse/core"
import { doc } from "firebase/firestore"
import { defineStore } from "pinia"
import { useCurrentUser } from "vuefire"

export type NavItem = (typeof defaultMenu)[number]

// Debounce for the "settled state → Firestore" watcher. Long enough to collapse
// a burst of edits into one write, short enough to feel instant.
const PERSIST_DEBOUNCE_MS = 500

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const asNavigationDoc = (value: unknown): LayoutNavigationDoc | null =>
  isRecord(value) ? (value as LayoutNavigationDoc) : null

export const useNavigationStore = defineStore("navigation", () => {
  const user = useCurrentUser()

  // ==========================================================================
  // State
  // ==========================================================================

  // Navigation lane (Firestore-authoritative, hydrated per user).
  const activeNavItems = ref<NavItem[]>([])

  // Single-flight guard: while a nav-items mutation is in flight, inbound
  // snapshots are ignored so the optimistic edit survives.
  const pendingNavigation = shallowRef(false)

  // ==========================================================================
  // Firestore document ref + read
  // ==========================================================================

  const navigationDocRef = computed(() => {
    const uid = user.value?.uid
    if (!uid) return null
    return doc(firestore, "users", uid, "layout", "navigation")
  })

  // `isLoading` drives the nav-items skeleton; internally it also gates the
  // confirmed-absent fallback so we don't flash the default menu mid-load.
  const { data: navDocData, isLoading } = useDocumentQuery(navigationDocRef)

  // ==========================================================================
  // Persistence
  // ==========================================================================

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

  // ==========================================================================
  // Hydration watcher (read → local state, guarded against optimistic clobber)
  // ==========================================================================

  // Navigation doc → nav items. (The `ui`/`agentVisibility` subfields of the
  // same doc are applied independently by `useUiPreferencesStore`.)
  watch(
    navDocData,
    (snapshot) => {
      // Loading window — don't flash defaults before the real doc arrives.
      if (snapshot === undefined) return

      const navigationDoc = asNavigationDoc(snapshot)
      if (!navigationDoc) {
        // Confirmed-absent (or non-object) doc: fall back to the default menu,
        // but only when we aren't mid-write and aren't still loading.
        if (!pendingNavigation.value && !isLoading.value) {
          activeNavItems.value = [...defaultMenu]
        }
        return
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

  // ==========================================================================
  // Persistence watcher (debounced: settled local state → Firestore)
  // ==========================================================================

  // No `deep` — every mutation reassigns `activeNavItems`.
  watchDebounced(
    activeNavItems,
    () => {
      if (pendingNavigation.value) return
      void persistNavigation()
    },
    { debounce: PERSIST_DEBOUNCE_MS }
  )

  // ==========================================================================
  // Actions (optimistic, single-flight via pendingNavigation)
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
      console.error(`[navigationStore] ${options.actionName} failed:`, error)
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
    activeNavItems,
    pendingNavigation,
    isLoading,

    // Actions
    toggleNavItem,
    setNavItems,
    resetNavItems,
  }
})
