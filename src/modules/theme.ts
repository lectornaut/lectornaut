import {
  defaultAccent,
  defaultFont,
  defaultSize,
  defaultZoom,
} from "@/helpers/defaults"
import { isTauri } from "@/helpers/utilities"
import { setTheme } from "@tauri-apps/api/app"

const initMode = () => {
  useColorMode({
    storageKey: "theme",
  })
}

export const accent = useStorage("accent", defaultAccent)

watch(accent, (value) => {
  document.documentElement.setAttribute("data-accent", value)
})

const initAccent = () => {
  useStorage("accent", defaultAccent)
  document.documentElement.setAttribute("data-accent", accent.value)
}

export const font = useStorage("font", defaultFont)

watch(font, (value) => {
  document.documentElement.setAttribute("data-font", value)
})

const initFont = () => {
  useStorage("font", defaultFont)
  document.documentElement.setAttribute("data-font", font.value)
}

export const size = useStorage("size", defaultSize)

watch(size, (value) => {
  document.documentElement.setAttribute("data-size", value)
})

const initSize = () => {
  useStorage("size", defaultSize)
  document.documentElement.setAttribute("data-size", size.value)
}

export const zoom = useStorage("zoom", defaultZoom)

watch(zoom, (value) => {
  document.documentElement.setAttribute("data-zoom", value)
})

const initZoom = () => {
  useStorage("zoom", defaultZoom)
  document.documentElement.setAttribute("data-zoom", zoom.value)
}

export const initTheme = () => {
  initMode()
  initAccent()
  initFont()
  initSize()
  initZoom()
}

export const { store, system, state } = useColorMode({
  storageKey: "theme",
})

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
