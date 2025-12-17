import { isTauri } from "@/composables/usePlatform"
import {
  defaultAccent,
  defaultFont,
  defaultSize,
  defaultZoom,
} from "@/helpers/defaults"
import { setTheme } from "@tauri-apps/api/app"

/**
 * Initializes the color mode (light/dark/auto)
 */
const initMode = () => {
  useColorMode({
    attribute: "data-theme",
    storageKey: "theme",
    modes: {
      accent: "accent",
    },
  })
}

export const accent = useStorage("accent", defaultAccent)

watch(accent, (value) => {
  document.documentElement.setAttribute("data-accent", value)
})

/**
 * Initializes the accent color and syncs it with the document root
 */
const initAccent = () => {
  useStorage("accent", defaultAccent)
  document.documentElement.setAttribute("data-accent", accent.value)
}

export const font = useStorage("font", defaultFont)

watch(font, (value) => {
  document.documentElement.setAttribute("data-font", value)
})

/**
 * Initializes the font preference and syncs it with the document root
 */
const initFont = () => {
  useStorage("font", defaultFont)
  document.documentElement.setAttribute("data-font", font.value)
}

export const size = useStorage("size", defaultSize)

watch(size, (value) => {
  document.documentElement.setAttribute("data-size", value)
})

/**
 * Initializes the text size preference and syncs it with the document root
 */
const initSize = () => {
  useStorage("size", defaultSize)
  document.documentElement.setAttribute("data-size", size.value)
}

export const zoom = useStorage("zoom", defaultZoom)

watch(zoom, (value) => {
  document.documentElement.setAttribute("data-zoom", value)
})

/**
 * Initializes the zoom level preference and syncs it with the document root
 */
const initZoom = () => {
  useStorage("zoom", defaultZoom)
  document.documentElement.setAttribute("data-zoom", zoom.value)
}

/**
 * Master initialization function for all theme-related settings
 */
export const initTheme = () => {
  initMode()
  initAccent()
  initFont()
  initSize()
  initZoom()
}

export const { store, system, state } = useColorMode({
  attribute: "data-theme",
  storageKey: "theme",
  modes: {
    accent: "accent",
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
