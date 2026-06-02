import { sendTestNotification as sendTestNotificationCallable } from "@/composables/useFunctions"
import { isTauri } from "@/composables/usePlatform"
import type {
  AccentId,
  BaseId,
  EditorFontSizeId,
  EditorThemeId,
  FontId,
  LanguageId,
  SizeId,
} from "@/helpers/defaults"
import {
  defaultAccent,
  defaultBase,
  defaultCustomAccentColor,
  defaultCustomBaseColor,
  defaultEditorFontSize,
  defaultEditorTheme,
  defaultFileDropOverlayShortcutKeys,
  defaultFont,
  defaultLanguage,
  defaultReducedMotion,
  defaultShortcutOverrides,
  defaultSize,
  defaultTheme,
  defaultTranslucentSidebar,
} from "@/helpers/defaults"
import { isDefaultHotkey } from "@/helpers/shortcuts"
import { firestore } from "@/modules/firebase"
import { queryClient } from "@/modules/queryClient"
import { parseSafe } from "@/schemas/_utils"
import { settingsThemeDocSchema } from "@/schemas/settings"
import {
  areNotificationSettingsEqual,
  cloneNotificationSettings,
  normalizeNotificationFrequency,
  normalizeNotificationSettings,
  type NotificationFrequency,
  type UserNotificationSettings,
} from "@/types/notifications"
import type { SettingsThemeDoc, ThemeMode } from "@/types/settings"
import { getErrorMessage } from "@/utils/firebase/firebase-errors"
import { useFirestoreMutation } from "@/utils/firebase/firebase-mutation"
import { createDebouncedCloudSync } from "@/utils/firebase/firebase-optimistic"
import { useDocumentQuery } from "@/utils/firebase/firebase-query"
import {
  queryKeys,
  type FirestoreQueryKey,
} from "@/utils/firebase/firebase-query-keys"
import {
  mutateSetDocument,
  safeSetDocument as safeSetDoc,
} from "@/utils/firebase/firebase-sync-engine"
import { normalizeHexColor } from "@/utils/theme/customTheme"
import { convertFileSrc, invoke } from "@tauri-apps/api/core"
import { resolveResource } from "@tauri-apps/api/path"
import { disable, enable } from "@tauri-apps/plugin-autostart"
import {
  isRegistered as isShortcutRegistered,
  register as registerGlobalShortcut,
  unregisterAll as unregisterAllGlobalShortcuts,
  unregister as unregisterGlobalShortcut,
} from "@tauri-apps/plugin-global-shortcut"
import {
  isPermissionGranted,
  requestPermission,
  sendNotification as sendNativeNotification,
} from "@tauri-apps/plugin-notification"
import { useStorage, watchDebounced } from "@vueuse/core"
import { collection, doc } from "firebase/firestore"
import { defineStore } from "pinia"
import { toast } from "vue-sonner"
import { useCurrentUser } from "vuefire"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

// Validate incoming theme docs against the Zod schema instead of an unchecked
// `as` cast. `isRecord` guards first so a missing/empty doc returns null
// silently (absence isn't a violation); a present-but-malformed doc is caught
// by `parseSafe` — loud in dev, zero-overhead pass-through in prod. This stops
// an invalid mode/base/font from round-tripping back out to `useStorage`.
const toSettingsThemeDoc = (value: unknown): SettingsThemeDoc | null =>
  isRecord(value)
    ? parseSafe(settingsThemeDocSchema, value, "settings.theme")
    : null

export const useSettingsStore = defineStore("settings", () => {
  const user = useCurrentUser()

  const mode = useStorage<ThemeMode>("theme", defaultTheme)
  const base = useStorage<BaseId>("base", defaultBase)
  const accent = useStorage<AccentId>("accent", defaultAccent)
  const customBaseColor = useStorage<string>(
    "customBaseColor",
    defaultCustomBaseColor
  )
  const customAccentColor = useStorage<string>(
    "customAccentColor",
    defaultCustomAccentColor
  )
  const font = useStorage<FontId>("font", defaultFont)
  const size = useStorage<SizeId>("size", defaultSize)
  const language = useStorage<LanguageId>("language", defaultLanguage)
  const editorTheme = useStorage<EditorThemeId>(
    "editorTheme",
    defaultEditorTheme
  )
  const editorFontSize = useStorage<EditorFontSizeId>(
    "editorFontSize",
    defaultEditorFontSize
  )
  const translucentSidebar = useStorage<boolean>(
    "translucentSidebar",
    defaultTranslucentSidebar
  )
  const reducedMotion = useStorage<boolean>(
    "reducedMotion",
    defaultReducedMotion
  )

  const themeSettings = reactive({
    mode,
    base,
    accent,
    customBaseColor,
    customAccentColor,
    font,
    size,
    language,
    editorTheme,
    editorFontSize,
    translucentSidebar,
    reducedMotion,
  })

  const themeDocRef = computed(() => {
    if (!user.value?.uid) return null
    return doc(
      collection(
        doc(collection(firestore, "users"), user.value.uid),
        "settings"
      ),
      "themes"
    )
  })

  const { data: themeDocData, isLoading: themePending } =
    useDocumentQuery(themeDocRef)

  async function persistTheme(): Promise<boolean> {
    return safeSetDoc(
      themeDocRef.value,
      {
        mode: mode.value,
        base: base.value,
        accent: accent.value,
        customBaseColor: customBaseColor.value,
        customAccentColor: customAccentColor.value,
        font: font.value,
        size: size.value,
        language: language.value,
        editorTheme: editorTheme.value,
        editorFontSize: editorFontSize.value,
        translucentSidebar: translucentSidebar.value,
        reducedMotion: reducedMotion.value,
      },
      "settings.themes.persist"
    )
  }

  // Re-entrancy-safe debounced persister. `pendingTheme` is read by the inbound
  // snapshot watch below to skip applying remote state mid-write. It must be
  // declared before that watch: the watch is `immediate`, so its callback runs
  // synchronously during setup and would hit `pendingTheme`'s temporal dead
  // zone if the declaration came later.
  const { trigger: persistThemeWithSync, pending: pendingTheme } =
    createDebouncedCloudSync({
      persist: persistTheme,
      id: "theme",
      source: "settings.themes.persist",
      canPersist: () => themeDocRef.value !== null,
      errorLabel: "settings.theme",
    })

  watch(
    themeDocData,
    (docData) => {
      if (pendingTheme.value) return

      const themeDoc = toSettingsThemeDoc(docData)
      if (!themeDoc) return

      if ("mode" in themeDoc && themeDoc.mode && themeDoc.mode !== mode.value) {
        mode.value = themeDoc.mode
      }
      if ("base" in themeDoc && themeDoc.base && themeDoc.base !== base.value) {
        base.value = themeDoc.base
      }
      if (
        "accent" in themeDoc &&
        themeDoc.accent &&
        themeDoc.accent !== accent.value
      ) {
        accent.value = themeDoc.accent
      }
      if ("customBaseColor" in themeDoc) {
        const nextCustomBaseColor = normalizeHexColor(
          themeDoc.customBaseColor,
          defaultCustomBaseColor
        )

        if (nextCustomBaseColor !== customBaseColor.value) {
          customBaseColor.value = nextCustomBaseColor
        }
      }
      if ("customAccentColor" in themeDoc) {
        const nextCustomAccentColor = normalizeHexColor(
          themeDoc.customAccentColor,
          defaultCustomAccentColor
        )

        if (nextCustomAccentColor !== customAccentColor.value) {
          customAccentColor.value = nextCustomAccentColor
        }
      }
      if ("font" in themeDoc && themeDoc.font && themeDoc.font !== font.value) {
        font.value = themeDoc.font
      }
      if ("size" in themeDoc && themeDoc.size && themeDoc.size !== size.value) {
        size.value = themeDoc.size
      }
      if (
        "language" in themeDoc &&
        themeDoc.language &&
        themeDoc.language !== language.value
      ) {
        language.value = themeDoc.language
      }
      if (
        "editorTheme" in themeDoc &&
        themeDoc.editorTheme &&
        themeDoc.editorTheme !== editorTheme.value
      ) {
        editorTheme.value = themeDoc.editorTheme
      }
      if (
        "editorFontSize" in themeDoc &&
        themeDoc.editorFontSize &&
        themeDoc.editorFontSize !== editorFontSize.value
      ) {
        editorFontSize.value = themeDoc.editorFontSize
      }
      if (
        "translucentSidebar" in themeDoc &&
        typeof themeDoc.translucentSidebar === "boolean" &&
        themeDoc.translucentSidebar !== translucentSidebar.value
      ) {
        translucentSidebar.value = themeDoc.translucentSidebar
      }
      if (
        "reducedMotion" in themeDoc &&
        typeof themeDoc.reducedMotion === "boolean" &&
        themeDoc.reducedMotion !== reducedMotion.value
      ) {
        reducedMotion.value = themeDoc.reducedMotion
      }
    },
    { immediate: true }
  )

  watch(
    customBaseColor,
    (value) => {
      const normalized = normalizeHexColor(value, defaultCustomBaseColor)
      if (normalized !== value) customBaseColor.value = normalized
    },
    { immediate: true }
  )

  watch(
    customAccentColor,
    (value) => {
      const normalized = normalizeHexColor(value, defaultCustomAccentColor)
      if (normalized !== value) customAccentColor.value = normalized
    },
    { immediate: true }
  )

  // Prevent cyclic "accent<->base" combinations that cannot resolve a palette.
  watch(
    [base, accent],
    ([nextBase, nextAccent], previousPair) => {
      if (nextBase !== "accent" || nextAccent !== "base") return

      const [prevBase, prevAccent] = previousPair ?? []
      const safePrevBase: BaseId =
        prevBase && prevBase !== "accent" ? prevBase : defaultBase
      const safePrevAccent: AccentId =
        prevAccent && prevAccent !== "base" ? prevAccent : defaultAccent

      if (prevAccent === "base" && prevBase !== "accent") {
        base.value = safePrevBase
        return
      }

      if (prevBase === "accent" && prevAccent !== "base") {
        accent.value = safePrevAccent
        return
      }

      base.value = safePrevBase
      accent.value = safePrevAccent
    },
    { immediate: true }
  )

  watchDebounced(
    [
      mode,
      base,
      accent,
      customBaseColor,
      customAccentColor,
      font,
      size,
      language,
      editorTheme,
      editorFontSize,
      translucentSidebar,
      reducedMotion,
    ],
    () => {
      void persistThemeWithSync()
    },
    { debounce: 500 }
  )

  const notificationSettingsDocRef = computed(() => {
    if (!user.value?.uid) return null
    return doc(firestore, "users", user.value.uid, "settings", "notifications")
  })

  const { data: notificationSettingsDoc, isLoading: notificationPending } =
    useDocumentQuery(notificationSettingsDocRef)

  const isUpdatingNotifications = ref<string | null>(null)

  // Reads straight from the realtime cache; the toggle below applies its
  // optimistic value into that cache (held until the server ack reconciles it),
  // which replaces the former optimistic-ref + reconcile-clear watch.
  const notificationSettings = computed(() =>
    normalizeNotificationSettings(notificationSettingsDoc.value)
  )

  const notificationMutation = useFirestoreMutation<
    {
      keys: FirestoreQueryKey[]
      apply: () => void
      rollback: () => void
      run: () => Promise<void>
    },
    void
  >({
    mutationFn: (vars) => vars.run(),
    optimistic: (vars) => ({
      keys: vars.keys,
      apply: vars.apply,
      rollback: vars.rollback,
    }),
    source: "settings.notifications",
  })

  async function persistNotificationSettings(
    key: string,
    updater: (current: UserNotificationSettings) => UserNotificationSettings,
    messages: {
      success: string
      error: string
    }
  ): Promise<boolean> {
    const docRef = notificationSettingsDocRef.value
    if (!docRef || isUpdatingNotifications.value !== null) {
      return false
    }

    const previous = cloneNotificationSettings(notificationSettings.value)
    const next = updater(previous)

    if (areNotificationSettingsEqual(previous, next)) {
      return true
    }

    const cacheKey = queryKeys.doc(docRef.path)
    const previousCache =
      queryClient.getQueryData<Record<string, unknown>>(cacheKey)
    isUpdatingNotifications.value = key

    try {
      await notificationMutation.mutateAsync({
        keys: [cacheKey],
        apply: () =>
          queryClient.setQueryData(
            cacheKey,
            next as unknown as Record<string, unknown>
          ),
        rollback: () => queryClient.setQueryData(cacheKey, previousCache),
        run: async () => {
          await mutateSetDocument(
            docRef,
            next as unknown as Record<string, unknown>,
            {
              source: "settings.notifications.persist",
              merge: true,
            }
          )
        },
      })
      toast.success(messages.success)
      return true
    } catch (error) {
      toast.error(messages.error, {
        description: getErrorMessage(error),
      })
      return false
    } finally {
      isUpdatingNotifications.value = null
    }
  }

  async function updateNotificationCategory(
    category: "communication" | "marketing",
    value: boolean
  ): Promise<boolean> {
    return persistNotificationSettings(
      category,
      (current) => ({
        ...current,
        categories: {
          ...current.categories,
          [category]: value,
        },
      }),
      {
        success: "Notification category updated",
        error: "Failed to update notification category",
      }
    )
  }

  async function updateNotificationFrequency(value: unknown): Promise<boolean> {
    if (typeof value !== "string") return false
    const frequency: NotificationFrequency =
      normalizeNotificationFrequency(value)

    return persistNotificationSettings(
      "frequency",
      (current) => ({
        ...current,
        frequency,
      }),
      {
        success: "Notification frequency updated",
        error: "Failed to update notification frequency",
      }
    )
  }

  async function updateNotificationChannel(
    channel: "email" | "inApp" | "native",
    value: boolean
  ): Promise<boolean> {
    return persistNotificationSettings(
      channel,
      (current) => ({
        ...current,
        channels: {
          ...current.channels,
          [channel]: value,
        },
      }),
      {
        success: "Notification channel updated",
        error: "Failed to update notification channel",
      }
    )
  }

  const isSendingTestNotification = ref<"email" | "inApp" | "native" | null>(
    null
  )

  async function sendTestNotification(
    channel: "email" | "inApp" | "native"
  ): Promise<boolean> {
    if (isSendingTestNotification.value) return false

    isSendingTestNotification.value = channel

    try {
      await sendTestNotificationCallable({ channel })

      if (channel === "native" && isTauri.value) {
        let granted = await isPermissionGranted()
        if (!granted) {
          const permission = await requestPermission()
          granted = permission === "granted"
        }

        if (granted) {
          let iconPath: string | undefined
          try {
            iconPath = await resolveResource("icons/icon.png")
          } catch {
            // Resource not available in dev mode
          }

          sendNativeNotification({
            title: "Test notification",
            body: "This is a test desktop notification. Everything is working!",
            sound: "default",
            ...(iconPath && {
              icon: iconPath,
              attachments: [
                {
                  id: "icon",
                  url: convertFileSrc(iconPath),
                },
              ],
            }),
          })
        } else {
          toast.error("Desktop notification permission denied")
          return false
        }
      }

      toast.success("Test notification sent")
      return true
    } catch (error) {
      toast.error("Failed to send test notification", {
        description: getErrorMessage(error),
      })
      return false
    } finally {
      isSendingTestNotification.value = null
    }
  }

  const isThemeLoading = computed(() => themePending.value)
  const isNotificationLoading = computed(() => notificationPending.value)

  // Preferences: Run on startup & Menu bar
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

  // Speech features (read-aloud playback, voice dictation). Device-local —
  // a microphone you have here you may not have elsewhere — so localStorage
  // only, no Firestore sync. Default on to preserve the always-available
  // behavior these features had before the toggles existed.
  const readAloudEnabled = useStorage<boolean>("readAloudEnabled", true)
  const dictationEnabled = useStorage<boolean>("dictationEnabled", true)

  watch(
    preferencesDocData,
    (docData) => {
      if (!isRecord(docData)) return
      if ("badgeCount" in docData && typeof docData.badgeCount === "boolean") {
        badgeCount.value = docData.badgeCount
      }
      if (
        "fileDropOverlayDragDrop" in docData &&
        typeof docData.fileDropOverlayDragDrop === "boolean"
      ) {
        fileDropOverlayDragDrop.value = docData.fileDropOverlayDragDrop
      }
      if (
        "fileDropOverlayShortcut" in docData &&
        typeof docData.fileDropOverlayShortcut === "boolean"
      ) {
        fileDropOverlayShortcut.value = docData.fileDropOverlayShortcut
      }
    },
    { immediate: true }
  )

  const isUpdatingPreferences = ref<string | null>(null)

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
      console.error(`[settingsStore] Failed to apply ${key}:`, error)
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
            "[settingsStore] Failed to sync drag-drop preference:",
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
        "[settingsStore] Failed to register global shortcut:",
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

  async function updatePreference(
    key: BooleanPreferenceKey,
    value: boolean
  ): Promise<boolean> {
    if (!preferencesDocRef.value || isUpdatingPreferences.value !== null)
      return false

    const prefMap = {
      badgeCount,
      fileDropOverlayDragDrop,
      fileDropOverlayShortcut,
    }
    const prefRef = prefMap[key]
    const previousValue = prefRef.value

    prefRef.value = value

    isUpdatingPreferences.value = key

    try {
      await mutateSetDocument(
        preferencesDocRef.value,
        { [key]: value },
        { source: "settings.preferences.persist", merge: true }
      )
      toast.success("Preference updated")
      return true
    } catch (error) {
      prefRef.value = previousValue
      toast.error("Failed to update preference", {
        description: getErrorMessage(error),
      })
      return false
    } finally {
      isUpdatingPreferences.value = null
    }
  }

  const isPreferencesLoading = computed(() => preferencesPending.value)

  // ──────────────────────────────────────────────────────────────────────────
  // Custom Shortcut Overrides
  // ──────────────────────────────────────────────────────────────────────────

  const shortcutOverrides = useStorage<Record<string, string>>(
    "shortcutOverrides",
    { ...defaultShortcutOverrides }
  )

  const shortcutsDocRef = computed(() => {
    if (!user.value?.uid) return null
    return doc(firestore, "users", user.value.uid, "settings", "shortcuts")
  })

  const { data: shortcutsDocData, isLoading: shortcutsPending } =
    useDocumentQuery(shortcutsDocRef)

  // Incoming sync: Firestore → localStorage
  let isShortcutSyncPending = false

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

  // Outgoing sync: localStorage → Firestore (debounced)
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
          "[settingsStore] Failed to sync shortcut overrides:",
          error
        )
      })
    },
    { debounce: 500, deep: true }
  )

  // Global hotkeys re-register reactively from `shortcutOverrides` via
  // `useGlobalHotkeys`; no manual rebind needed here.

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

  const isShortcutsLoading = computed(() => shortcutsPending.value)

  const hasCustomShortcuts = computed(
    () => Object.keys(shortcutOverrides.value).length > 0
  )

  return {
    themeSettings,
    pendingTheme,
    isThemeLoading,
    notificationSettings,
    isUpdatingNotifications,
    isNotificationLoading,
    updateNotificationCategory,
    updateNotificationFrequency,
    updateNotificationChannel,
    sendTestNotification,
    isSendingTestNotification,
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
    shortcutOverrides,
    updateShortcutOverride,
    resetShortcutOverride,
    resetAllShortcutOverrides,
    isShortcutsLoading,
    hasCustomShortcuts,
  }
})
