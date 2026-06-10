/**
 * App Preferences Store
 * =====================
 *
 * Owns the per-user application + device preferences. Two flavors live here:
 *
 *  - **User-level prefs** (round-trip `users/{uid}/settings/preferences`):
 *    dock badge count, the file-drop overlay (drag-drop toggle, global-shortcut
 *    toggle AND its recorded key combo), and the speech toggles (read-aloud +
 *    dictation). Outbound via `updatePreference` / `updateShortcutKeys` (a
 *    direct single-flight `mutateSetDocument` — not the optimistic `runWrite`
 *    seam), inbound via the doc watch — so changes propagate live to every
 *    running instance. The `useStorage` refs double as the local mirror /
 *    cold-start cache. The server whitelists these fields per-key in
 *    functions/src/syncSettlement.ts (`validateUserPreferencesPayload`):
 *    adding a synced field means extending that whitelist AND
 *    `userPreferencesSchema` (src/schemas/domain.ts — the authStore's
 *    converted listener owns the shared cache entry, and zod strips unknown
 *    fields on read), and deploying functions BEFORE the client ships, or
 *    those writes settle as immediate permission-denied rejects (optimistic
 *    rollback + error toast).
 *  - **Device-local prefs** (localStorage only, deliberately never synced):
 *    run-on-startup (this machine's autostart), menu-bar/tray visibility,
 *    automatic updates + last-check (this install's updater), and
 *    open-in-desktop-app (this browser's link handling, read pre-auth by
 *    `deepLink.ts`). All per-machine/per-browser semantics.
 *
 * Extracted from the former `settingsStore` monolith as phase 3 of its split.
 * Store consumers: `SettingsPreferences.vue`, `useDictation`, `useReadAloud`.
 * (Several keys are also read via independent `useStorage` re-declarations —
 * `main.ts` for `automaticUpdates`/`lastUpdateCheck`, `useNotifications` for
 * `badgeCount` — sharing state through the localStorage key, not this store.)
 */

import { isTauri } from "@/composables/usePlatform"
import { defaultFileDropOverlayShortcutKeys } from "@/helpers/defaults"
import { firestore } from "@/modules/firebase"
import { getErrorMessage } from "@/utils/firebase/firebase-errors"
import { useDocumentQuery } from "@/utils/firebase/firebase-query"
import { mutateSetDocument } from "@/utils/firebase/firebase-sync-engine"
import { invoke } from "@tauri-apps/api/core"
import { disable, enable } from "@tauri-apps/plugin-autostart"
import {
  isRegistered as isShortcutRegistered,
  register as registerGlobalShortcut,
  unregisterAll as unregisterAllGlobalShortcuts,
  unregister as unregisterGlobalShortcut,
} from "@tauri-apps/plugin-global-shortcut"
import { useStorage } from "@vueuse/core"
import { doc } from "firebase/firestore"
import { defineStore } from "pinia"
import { toast } from "vue-sonner"
import { useCurrentUser } from "vuefire"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

export const useAppPreferencesStore = defineStore("appPreferences", () => {
  const user = useCurrentUser()

  const preferencesDocRef = computed(() => {
    if (!user.value?.uid) return null
    return doc(firestore, "users", user.value.uid, "settings", "preferences")
  })

  const { data: preferencesDocData, isLoading: preferencesPending } =
    useDocumentQuery(preferencesDocRef)

  const runOnStartup = useStorage<boolean>("runOnStartup", false)
  const menuBar = useStorage<boolean>("menuBar", true)
  const badgeCount = useStorage<boolean>("badgeCount", true)
  const automaticUpdates = useStorage<boolean>("automaticUpdates", true)
  const lastUpdateCheck = useStorage<number>("lastUpdateCheck", 0)

  const fileDropOverlayDragDrop = useStorage<boolean>(
    "fileDropOverlayDragDrop",
    true
  )
  const fileDropOverlayShortcut = useStorage<boolean>(
    "fileDropOverlayShortcut",
    false
  )
  const fileDropOverlayShortcutKeys = useStorage<string>(
    "fileDropOverlayShortcutKeys",
    defaultFileDropOverlayShortcutKeys
  )

  const openInDesktopApp = useStorage<boolean>("openInDesktopApp", true)

  // Speech features (read-aloud playback, voice dictation). User-level intent,
  // synced via the preferences doc like badgeCount; whether the feature can
  // run on THIS device stays a separate runtime gate (`isSupported` in
  // useReadAloud/useDictation). Default on to preserve the always-available
  // behavior these features had before the toggles existed.
  const readAloudEnabled = useStorage<boolean>("readAloudEnabled", true)
  const dictationEnabled = useStorage<boolean>("dictationEnabled", true)

  // Declared before the inbound watch (immediate:true can run synchronously
  // against cached query data) — it gates which doc fields the watch copies.
  const isUpdatingPreferences = ref<string | null>(null)

  // Copy one doc field into its local mirror — unless that key's own write is
  // in flight: the snapshot still carries the pre-write value until the op
  // settles (and unrelated writers like `currentTeamId` share this doc), so
  // copying it would visibly revert the optimistic toggle mid-flight.
  const applyDocField = <T extends boolean | string>(
    docData: Record<string, unknown>,
    key: string,
    type: "boolean" | "string",
    target: { value: T }
  ) => {
    if (isUpdatingPreferences.value === key) return
    const value = docData[key]
    if (typeof value === type) {
      target.value = value as T
    }
  }

  watch(
    preferencesDocData,
    (docData) => {
      if (!isRecord(docData)) return
      applyDocField(docData, "badgeCount", "boolean", badgeCount)
      applyDocField(
        docData,
        "fileDropOverlayDragDrop",
        "boolean",
        fileDropOverlayDragDrop
      )
      applyDocField(
        docData,
        "fileDropOverlayShortcut",
        "boolean",
        fileDropOverlayShortcut
      )
      applyDocField(
        docData,
        "fileDropOverlayShortcutKeys",
        "string",
        fileDropOverlayShortcutKeys
      )
      applyDocField(docData, "readAloudEnabled", "boolean", readAloudEnabled)
      applyDocField(docData, "dictationEnabled", "boolean", dictationEnabled)
    },
    { immediate: true }
  )

  async function applyTauriPreference(
    key: "runOnStartup" | "menuBar",
    value: boolean
  ): Promise<void> {
    if (!isTauri.value) return

    try {
      if (key === "runOnStartup") {
        if (value) await enable()
        else await disable()
      } else if (key === "menuBar") {
        await invoke("set_tray_visible", { visible: value })
      }
    } catch (error) {
      console.error(`[appPreferencesStore] Failed to apply ${key}:`, error)
    }
  }

  // Sync Tauri state when preferences load from Firestore
  watch(
    [runOnStartup, menuBar],
    ([newRunOnStartup, newMenuBar]) => {
      void applyTauriPreference("runOnStartup", newRunOnStartup)
      void applyTauriPreference("menuBar", newMenuBar)
    },
    { immediate: true }
  )

  // Sync file drop overlay drag-and-drop preference to native side
  watch(
    fileDropOverlayDragDrop,
    (enabled) => {
      if (!isTauri.value) return
      void invoke("set_file_capture_drag_enabled", { enabled }).catch(
        (error: unknown) => {
          console.error(
            "[appPreferencesStore] Failed to sync drag-drop preference:",
            error
          )
        }
      )
    },
    { immediate: true }
  )

  // ── File drop overlay OS-level global shortcut ──────────────────────
  //
  // Converts our internal TanStack format ("Mod+Shift+D") to the Tauri
  // accelerator format ("CommandOrControl+Shift+D") documented at:
  // https://v2.tauri.app/plugin/global-shortcut/
  //
  // Key rules:
  //  - The handler receives a ShortcutEvent with { state: "Pressed" | "Released" }
  //    and must only act on "Pressed" to avoid double-firing.
  //  - In dev mode (HMR), the plugin may already have the shortcut registered
  //    from a previous hot-reload. Always unregisterAll before re-registering.
  //  - Wrap all Tauri calls in try/catch — the plugin throws if it isn't
  //    available (web builds) or if the shortcut is claimed by the OS.

  let currentGlobalShortcut: string | null = null

  const TAURI_KEY_MAP: Record<string, string> = {
    arrowup: "Up",
    arrowdown: "Down",
    arrowleft: "Left",
    arrowright: "Right",
    escape: "Escape",
    enter: "Enter",
    backspace: "Backspace",
    delete: "Delete",
    tab: "Tab",
    space: "Space",
    " ": "Space",
  }

  const toTauriShortcut = (hotkey: string): string =>
    hotkey
      .split("+")
      .map((part) => {
        const key = part.trim().toLowerCase()
        switch (key) {
          // `Mod` (and legacy `cmd`) → ⌘ on macOS, Ctrl elsewhere.
          case "mod":
          case "cmd":
          case "command":
          case "meta":
            return "CommandOrControl"
          case "ctrl":
          case "control":
            return "Control"
          case "shift":
            return "Shift"
          case "alt":
          case "option":
            return "Alt"
          default:
            return TAURI_KEY_MAP[key] ?? part.trim().toUpperCase()
        }
      })
      .join("+")

  const toDisplayShortcut = (hotkey: string): string =>
    hotkey
      .split("+")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("+")

  const cleanupGlobalShortcut = async () => {
    if (!currentGlobalShortcut) return
    try {
      if (await isShortcutRegistered(currentGlobalShortcut)) {
        await unregisterGlobalShortcut(currentGlobalShortcut)
      }
    } catch {
      // Shortcut may already be unregistered or plugin unavailable
    }
    currentGlobalShortcut = null
  }

  const syncGlobalShortcut = async (enabled: boolean, keys: string) => {
    if (!isTauri.value) return

    await cleanupGlobalShortcut()

    if (!enabled || !keys) return

    const tauriShortcut = toTauriShortcut(keys)

    try {
      // In dev mode (HMR), the shortcut may still be registered from a
      // previous module instance. Check first to avoid a registration panic.
      if (await isShortcutRegistered(tauriShortcut)) {
        await unregisterGlobalShortcut(tauriShortcut)
      }

      await registerGlobalShortcut(tauriShortcut, (event) => {
        if (event.state === "Pressed") {
          void invoke("keep_file_capture_window_open")
        }
      })
      currentGlobalShortcut = tauriShortcut
    } catch (error) {
      console.error(
        "[appPreferencesStore] Failed to register global shortcut:",
        error
      )
      toast.error(`Failed to register ${toDisplayShortcut(keys)}`, {
        description:
          "This shortcut conflicts with a system or app shortcut. Try a different combination.",
      })
    }
  }

  watch(
    [fileDropOverlayShortcut, fileDropOverlayShortcutKeys],
    ([enabled, keys]) => {
      void syncGlobalShortcut(enabled, keys)
    },
    { immediate: true }
  )

  // Clean up all OS-level shortcuts when the store's effect scope is
  // disposed (e.g. HMR reload). unregisterAll is safer than tracking
  // individual shortcuts across hot-reloads.
  onScopeDispose(() => {
    void unregisterAllGlobalShortcuts().catch(() => {})
    currentGlobalShortcut = null
  })

  type BooleanPreferenceKey =
    | "badgeCount"
    | "fileDropOverlayDragDrop"
    | "fileDropOverlayShortcut"
    | "readAloudEnabled"
    | "dictationEnabled"

  // Optimistic single-flight write of one synced preference field: set the
  // local mirror, persist, roll back on failure. Every key written here must
  // be whitelisted server-side in syncSettlement's
  // `validateUserPreferencesPayload` or the op settles as permission-denied.
  async function persistPreference<T extends boolean | string>(
    key: string,
    prefRef: { value: T },
    value: T
  ): Promise<boolean> {
    if (!preferencesDocRef.value || isUpdatingPreferences.value !== null)
      return false

    const previousValue = prefRef.value
    prefRef.value = value
    isUpdatingPreferences.value = key

    try {
      await mutateSetDocument(
        preferencesDocRef.value,
        { [key]: value },
        { source: "settings.preferences.persist", merge: true }
      )
      toast.success("Preference updated.")
      return true
    } catch (error) {
      // Roll back only if our optimistic value is still in place — an inbound
      // snapshot may have applied a fresher remote value mid-flight.
      if (prefRef.value === value) {
        prefRef.value = previousValue
      }
      toast.error("Failed to update preference", {
        description: getErrorMessage(error),
      })
      return false
    } finally {
      isUpdatingPreferences.value = null
    }
  }

  async function updatePreference(
    key: BooleanPreferenceKey,
    value: boolean
  ): Promise<boolean> {
    const prefMap = {
      badgeCount,
      fileDropOverlayDragDrop,
      fileDropOverlayShortcut,
      readAloudEnabled,
      dictationEnabled,
    }
    return persistPreference(key, prefMap[key], value)
  }

  /** Persist the recorded global-shortcut combo ("" = shortcut cleared). */
  const updateShortcutKeys = (keys: string): Promise<boolean> =>
    persistPreference(
      "fileDropOverlayShortcutKeys",
      fileDropOverlayShortcutKeys,
      keys
    )

  const isPreferencesLoading = computed(() => preferencesPending.value)

  return {
    runOnStartup,
    menuBar,
    badgeCount,
    automaticUpdates,
    lastUpdateCheck,
    fileDropOverlayDragDrop,
    fileDropOverlayShortcut,
    fileDropOverlayShortcutKeys,
    openInDesktopApp,
    readAloudEnabled,
    dictationEnabled,
    isUpdatingPreferences,
    isPreferencesLoading,
    updatePreference,
    updateShortcutKeys,
  }
})
