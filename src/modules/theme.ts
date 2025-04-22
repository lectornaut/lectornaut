import { defaultAccent } from "@/helpers/defaults"
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

export const initTheme = () => {
  initMode()
  initAccent()
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
