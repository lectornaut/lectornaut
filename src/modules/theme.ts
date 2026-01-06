import { isTauri } from "@/composables/usePlatform"
import { useLayoutStore } from "@/stores/layoutStore"
import { setTheme } from "@tauri-apps/api/app"
import { storeToRefs } from "pinia"

export const { store, system, state } = useColorMode({
  attribute: "data-theme",
  storageKey: "theme",
  modes: {
    accent: "accent",
  },
})

// Initialize theme sync
export const initTheme = () => {
  const layoutStore = useLayoutStore()
  const { themeSettings } = storeToRefs(layoutStore)

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
      themeSettings.value.mode = val
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
    const s = useLayoutStore()
    return s.themeSettings.accent
  },
  set: (val: string) => {
    const s = useLayoutStore()
    s.themeSettings.accent = val
  },
})

export const base = computed({
  get: () => {
    const s = useLayoutStore()
    return s.themeSettings.base
  },
  set: (val: string) => {
    const s = useLayoutStore()
    s.themeSettings.base = val
  },
})

export const font = computed({
  get: () => {
    const s = useLayoutStore()
    return s.themeSettings.font
  },
  set: (val: string) => {
    const s = useLayoutStore()
    s.themeSettings.font = val
  },
})

export const size = computed({
  get: () => {
    const s = useLayoutStore()
    return s.themeSettings.size
  },
  set: (val: string) => {
    const s = useLayoutStore()
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
      case "accent":
        await setTheme(null)
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
