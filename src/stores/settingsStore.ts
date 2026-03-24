import { sendTestNotification as sendTestNotificationCallable } from "@/composables/useFunctions"
import { isTauri } from "@/composables/usePlatform"
import type {
  AccentId,
  BaseId,
  FontId,
  LanguageId,
  SizeId,
} from "@/helpers/defaults"
import {
  defaultAccent,
  defaultBase,
  defaultCustomAccentColor,
  defaultCustomBaseColor,
  defaultFont,
  defaultLanguage,
  defaultSize,
  defaultTheme,
} from "@/helpers/defaults"
import {
  areNotificationSettingsEqual,
  cloneNotificationSettings,
  normalizeNotificationFrequency,
  normalizeNotificationSettings,
  type NotificationFrequency,
  type UserNotificationSettings,
} from "@/types/notifications"
import type { SettingsThemeDoc, ThemeMode } from "@/types/settings"
import { withCloudSyncOperation } from "@/utils/firebase/firebase-optimistic"
import { mutateSetDocument } from "@/utils/firebase/firebase-sync-engine"
import { normalizeHexColor } from "@/utils/theme/customTheme"
import { convertFileSrc, invoke } from "@tauri-apps/api/core"
import { resolveResource } from "@tauri-apps/api/path"
import { disable, enable } from "@tauri-apps/plugin-autostart"
import {
  isRegistered as isShortcutRegistered,
  register as registerGlobalShortcut,
  unregister as unregisterGlobalShortcut,
  unregisterAll as unregisterAllGlobalShortcuts,
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
import { useCurrentUser, useDocument, useFirestore } from "vuefire"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const toSettingsThemeDoc = (value: unknown): SettingsThemeDoc | null =>
  isRecord(value) ? (value as SettingsThemeDoc) : null

export const useSettingsStore = defineStore("settings", () => {
  const db = useFirestore()
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

  const themeSettings = reactive({
    mode,
    base,
    accent,
    customBaseColor,
    customAccentColor,
    font,
    size,
    language,
  })

  const pendingTheme = shallowRef(false)
  const isThemePersistQueued = ref(false)

  const themeDocRef = computed(() => {
    if (!user.value?.uid) return null
    return doc(
      collection(doc(collection(db, "users"), user.value.uid), "settings"),
      "themes"
    )
  })

  const { data: themeDocData, pending: themePending } = useDocument(themeDocRef)

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

  async function safeSetDoc(
    docRef: ReturnType<typeof doc> | null,
    data: Record<string, unknown>,
    source: string
  ): Promise<boolean> {
    if (!docRef) return false
    try {
      await mutateSetDocument(docRef, data, {
        source,
        merge: true,
      })
      return true
    } catch (error) {
      console.error("[settingsStore] Failed to persist to Firestore:", error)
      return false
    }
  }

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
      },
      "settings.themes.persist"
    )
  }

  async function persistThemeWithSync(): Promise<void> {
    if (!themeDocRef.value) return

    if (pendingTheme.value) {
      isThemePersistQueued.value = true
      return
    }

    pendingTheme.value = true
    isThemePersistQueued.value = false

    try {
      await withCloudSyncOperation(
        async () => {
          const success = await persistTheme()
          if (!success) {
            throw new Error("Failed to persist theme")
          }
        },
        {
          id: "theme",
          source: "settings.themes.persist",
        }
      )
    } catch (error) {
      console.error("[settingsStore] persistTheme failed:", error)
    } finally {
      pendingTheme.value = false

      if (isThemePersistQueued.value) {
        void persistThemeWithSync()
      }
    }
  }

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
    ],
    () => {
      void persistThemeWithSync()
    },
    { debounce: 500 }
  )

  const notificationSettingsDocRef = computed(() => {
    if (!user.value?.uid) return null
    return doc(db, "users", user.value.uid, "settings", "notifications")
  })

  const { data: notificationSettingsDoc, pending: notificationPending } =
    useDocument(notificationSettingsDocRef)

  const optimisticNotificationSettings = ref<UserNotificationSettings | null>(
    null
  )
  const isUpdatingNotifications = ref<string | null>(null)

  const notificationSettings = computed(() =>
    optimisticNotificationSettings.value
      ? cloneNotificationSettings(optimisticNotificationSettings.value)
      : normalizeNotificationSettings(notificationSettingsDoc.value)
  )

  watch(
    () => notificationSettingsDoc.value,
    (nextValue) => {
      if (!optimisticNotificationSettings.value) return
      const remote = normalizeNotificationSettings(nextValue)
      if (
        areNotificationSettingsEqual(
          remote,
          optimisticNotificationSettings.value
        )
      ) {
        optimisticNotificationSettings.value = null
      }
    }
  )

  async function persistNotificationSettings(
    key: string,
    updater: (current: UserNotificationSettings) => UserNotificationSettings,
    messages: {
      success: string
      error: string
    }
  ): Promise<boolean> {
    if (
      !notificationSettingsDocRef.value ||
      isUpdatingNotifications.value !== null
    ) {
      return false
    }

    const previous = cloneNotificationSettings(notificationSettings.value)
    const next = updater(previous)

    if (areNotificationSettingsEqual(previous, next)) {
      return true
    }

    optimisticNotificationSettings.value = next
    isUpdatingNotifications.value = key

    try {
      await mutateSetDocument(
        notificationSettingsDocRef.value,
        next as unknown as Record<string, unknown>,
        {
          source: "settings.notifications.persist",
          merge: true,
        }
      )
      toast.success(messages.success)
      return true
    } catch (error) {
      optimisticNotificationSettings.value = previous
      toast.error(messages.error, {
        description: (error as Error).message,
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
        description: (error as Error).message,
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
    return doc(db, "users", user.value.uid, "settings", "preferences")
  })

  const { data: preferencesDocData, pending: preferencesPending } =
    useDocument(preferencesDocRef)

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
    "cmd+shift+d"
  )

  const openInDesktopApp = useStorage<boolean>("openInDesktopApp", true)

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
  // Converts our internal format ("cmd+shift+d") to the Tauri accelerator
  // format ("CommandOrControl+Shift+D") documented at:
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
    " ": "Space",
  }

  const toTauriShortcut = (hotkey: string): string =>
    hotkey
      .split("+")
      .map((part) => {
        const key = part.trim().toLowerCase()
        switch (key) {
          case "cmd":
            return "CommandOrControl"
          case "ctrl":
            return "Control"
          case "shift":
            return "Shift"
          case "alt":
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
        description: (error as Error).message,
      })
      return false
    } finally {
      isUpdatingPreferences.value = null
    }
  }

  const isPreferencesLoading = computed(() => preferencesPending.value)

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
    isUpdatingPreferences,
    isPreferencesLoading,
    updatePreference,
  }
})
