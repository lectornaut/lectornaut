/**
 * Shortcuts Store
 * ===============
 *
 * Owns the per-user custom keyboard-shortcut overrides — the user's remapping
 * of in-app hotkeys on top of the built-in defaults. Backed by the `overrides`
 * subfield of the per-user `users/{uid}/settings/shortcuts` document, so a
 * user's remaps follow them across devices.
 *
 * Persistence is bidirectional and localStorage-first: every edit lands in a
 * `useStorage` ref instantly (offline-safe), an inbound watch hydrates from
 * Firestore (guarded by `isShortcutSyncPending` so an applied snapshot can't
 * echo straight back out through the outbound watcher), and an outbound
 * `watchDebounced` mirrors settled local state to Firestore. The OS-level
 * re-registration of hotkeys is handled reactively by `useGlobalHotkeys`, which
 * observes `shortcutOverrides`; this store only owns the data.
 *
 * Extracted from the former `settingsStore` "user settings" monolith as phase 1
 * of its split, mirroring the layoutStore → tabs/nav/ui split. Its Firestore
 * doc, persistence idiom, and consumers (Shortcuts.vue, useGlobalHotkeys,
 * useShortcutKeys) are disjoint from the theme/notification/preference concerns.
 */

import { defaultShortcutOverrides } from "@/helpers/defaults"
import { isDefaultHotkey } from "@/helpers/shortcuts"
import { firestore } from "@/modules/firebase"
import { useDocumentQuery } from "@/utils/firebase/firebase-query"
import { mutateSetDocument } from "@/utils/firebase/firebase-sync-engine"
import { useStorage, watchDebounced } from "@vueuse/core"
import { doc } from "firebase/firestore"
import { defineStore } from "pinia"
import { useCurrentUser } from "vuefire"

// Debounce for the "settled state → Firestore" watcher. Long enough to collapse
// a burst of edits into one write, short enough to feel instant.
const PERSIST_DEBOUNCE_MS = 500

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

export const useShortcutsStore = defineStore("shortcuts", () => {
  const user = useCurrentUser()

  // ==========================================================================
  // State (localStorage-authoritative, mirrored to Firestore)
  // ==========================================================================

  const shortcutOverrides = useStorage<Record<string, string>>(
    "shortcutOverrides",
    { ...defaultShortcutOverrides }
  )

  // ==========================================================================
  // Firestore document ref + read
  // ==========================================================================

  const shortcutsDocRef = computed(() => {
    if (!user.value?.uid) return null
    return doc(firestore, "users", user.value.uid, "settings", "shortcuts")
  })

  const { data: shortcutsDocData, isLoading: shortcutsPending } =
    useDocumentQuery(shortcutsDocRef)

  // ==========================================================================
  // Bidirectional sync (re-entrancy-guarded)
  // ==========================================================================

  // While true, an inbound snapshot is being applied to local state; the
  // outbound watcher skips it so the apply doesn't echo straight back out.
  let isShortcutSyncPending = false

  // Incoming sync: Firestore → localStorage.
  watch(
    shortcutsDocData,
    (docData) => {
      if (!isRecord(docData)) return
      if ("overrides" in docData && isRecord(docData.overrides)) {
        isShortcutSyncPending = true
        shortcutOverrides.value = docData.overrides as Record<string, string>
        nextTick(() => {
          isShortcutSyncPending = false
        })
      }
    },
    { immediate: true }
  )

  // Outgoing sync: localStorage → Firestore (debounced).
  watchDebounced(
    shortcutOverrides,
    (overrides) => {
      if (isShortcutSyncPending) return
      if (!shortcutsDocRef.value) return
      void mutateSetDocument(
        shortcutsDocRef.value,
        { overrides },
        { source: "settings.shortcuts.persist", merge: true }
      ).catch((error: unknown) => {
        console.error(
          "[shortcutsStore] Failed to sync shortcut overrides:",
          error
        )
      })
    },
    { debounce: PERSIST_DEBOUNCE_MS, deep: true }
  )

  // Global hotkeys re-register reactively from `shortcutOverrides` via
  // `useGlobalHotkeys`; no manual rebind needed here.

  // ==========================================================================
  // Actions
  // ==========================================================================

  function updateShortcutOverride(shortcutId: string, hotkeys: string): void {
    if (isDefaultHotkey(shortcutId, hotkeys)) {
      resetShortcutOverride(shortcutId)
      return
    }

    shortcutOverrides.value = {
      ...shortcutOverrides.value,
      [shortcutId]: hotkeys,
    }
  }

  function resetShortcutOverride(shortcutId: string): void {
    const { [shortcutId]: _, ...rest } = shortcutOverrides.value
    shortcutOverrides.value = rest
  }

  function resetAllShortcutOverrides(): void {
    shortcutOverrides.value = { ...defaultShortcutOverrides }
  }

  // ==========================================================================
  // Computed
  // ==========================================================================

  const isShortcutsLoading = computed(() => shortcutsPending.value)

  const hasCustomShortcuts = computed(
    () => Object.keys(shortcutOverrides.value).length > 0
  )

  return {
    // State
    shortcutOverrides,
    isShortcutsLoading,
    hasCustomShortcuts,

    // Actions
    updateShortcutOverride,
    resetShortcutOverride,
    resetAllShortcutOverrides,
  }
})
