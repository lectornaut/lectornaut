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
 * Firestore, and an outbound `watchDebounced` mirrors settled local state to
 * Firestore as a FULL-document replace (`merge: false`) — a merge write can
 * never delete map keys, so per-row resets and reset-all would silently fail
 * to propagate and resurrect on the next snapshot. The server enforces the
 * full-replace contract (`validateUserShortcutsPayload` in
 * functions/src/syncSettlement.ts), and an inbound-content compare keeps
 * applied snapshots from echoing back out through the outbound watcher. The
 * OS-level re-registration of hotkeys is handled reactively by
 * `useGlobalHotkeys`, which observes `shortcutOverrides`; this store only
 * owns the data.
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

  // Serialized form of the last overrides map applied FROM Firestore. The
  // outbound watcher skips payloads matching it, so inbound applies (and the
  // settle-echo of our own writes) don't bounce back out. A boolean flag
  // cleared on nextTick can't do this job: the outbound watcher is debounced
  // 500ms and would read the flag long after it reset.
  let lastInboundOverridesJson: string | null = null

  // Incoming sync: Firestore → localStorage (wholesale replace — the doc's
  // `overrides` field always carries the complete map, see outbound below).
  watch(
    shortcutsDocData,
    (docData) => {
      if (!isRecord(docData)) return
      if ("overrides" in docData && isRecord(docData.overrides)) {
        const overrides = docData.overrides as Record<string, string>
        lastInboundOverridesJson = JSON.stringify(overrides)
        shortcutOverrides.value = overrides
      }
    },
    { immediate: true }
  )

  // Outgoing sync: localStorage → Firestore (debounced), as a FULL replace.
  // `merge: true` would deep-merge the map server-side: key DELETIONS (per-row
  // reset / reset-all) would never reach the remote doc, and the inbound
  // wholesale-replace would resurrect them locally on the next snapshot. The
  // payload always carries the complete map, and the server rejects merge
  // writes to this doc (`validateUserShortcutsPayload`).
  watchDebounced(
    shortcutOverrides,
    (overrides) => {
      if (!shortcutsDocRef.value) return
      if (JSON.stringify(overrides) === lastInboundOverridesJson) return
      void mutateSetDocument(
        shortcutsDocRef.value,
        { overrides },
        { source: "settings.shortcuts.persist", merge: false }
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
