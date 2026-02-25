import { isTauri } from "@/composables/usePlatform"
import type { AccentId, BaseId, FontId, SizeId } from "@/helpers/defaults"
import { useSettingsStore } from "@/stores/settingsStore"
import type { ThemeMode } from "@/types/settings"
import { setTheme } from "@tauri-apps/api/app"
import { storeToRefs } from "pinia"

export const { store, system, state } = useColorMode({
  attribute: "data-theme",
  storageKey: "theme",
})

// Initialize theme sync
export const initTheme = () => {
  const settingsStore = useSettingsStore()
  const { themeSettings } = storeToRefs(settingsStore)

  // Sync Mode
  watch(
    () => themeSettings.value.mode,
    (val) => {
      if (val && val !== store.value) {
        store.value = val
      }
    },
    { immediate: true }
  )

  watch(store, (val) => {
    if (val && val !== themeSettings.value.mode) {
      themeSettings.value.mode = val as ThemeMode
    }
  })

  // Sync Accent
  watch(
    () => themeSettings.value.accent,
    (val) => {
      document.documentElement.setAttribute("data-accent", val)
    },
    { immediate: true }
  )

  // Sync Base
  watch(
    () => themeSettings.value.base,
    (val) => {
      document.documentElement.setAttribute("data-base", val)
    },
    { immediate: true }
  )

  // Sync Font
  watch(
    () => themeSettings.value.font,
    (val) => {
      document.documentElement.setAttribute("data-font", val)
    },
    { immediate: true }
  )

  // Sync Size
  watch(
    () => themeSettings.value.size,
    (val) => {
      document.documentElement.setAttribute("data-size", val)
    },
    { immediate: true }
  )
}

// Export writables that proxy to the store
// We need to use a getter/setter approach or just export the store refs directly if possible,
// but to maintain API compatibility with usages like `v-model="accent"`, using a computed wrapper is best.

// Helper to create a writable computed for store refs that might be accessed before store init?
// Actually, `initTheme` is called likely in App setup.
// But `accent`, `font`, `size` are imported in Settings.vue.
// If we export them as computed properties accessing the store, we need to ensure pinia is active.
// It is active in components.

export const accent = computed({
  get: () => {
    const s = useSettingsStore()
    return s.themeSettings.accent
  },
  set: (val: AccentId) => {
    const s = useSettingsStore()
    s.themeSettings.accent = val
  },
})

export const base = computed({
  get: () => {
    const s = useSettingsStore()
    return s.themeSettings.base
  },
  set: (val: BaseId) => {
    const s = useSettingsStore()
    s.themeSettings.base = val
  },
})

export const font = computed({
  get: () => {
    const s = useSettingsStore()
    return s.themeSettings.font
  },
  set: (val: FontId) => {
    const s = useSettingsStore()
    s.themeSettings.font = val
  },
})

export const size = computed({
  get: () => {
    const s = useSettingsStore()
    return s.themeSettings.size
  },
  set: (val: SizeId) => {
    const s = useSettingsStore()
    s.themeSettings.size = val
  },
})

// Sync Tauri app window theme with internal theme state
if (isTauri.value) {
  watch(store, async (value) => {
    switch (value) {
      case "light":
        await setTheme("light")
        break
      case "dark":
        await setTheme("dark")
        break
      case "auto":
        await setTheme(null)
        break
      default:
        await setTheme(null)
        break
    }
  })
}
