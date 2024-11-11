import { defaultAccent } from "@/helpers/defaults"
import { isTauri } from "@/helpers/utilities"
import { invoke } from "@tauri-apps/api/core"

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

const initSidebars = () => {
  useStorage("leftSidebarVisibility", true)
  useStorage("rightSidebarVisibility", false)
}

export const leftSidebarVisibility = useStorage("leftSidebarVisibility", true)
export const rightSidebarVisibility = useStorage("rightSidebarVisibility", true)

export const initTheme = () => {
  initMode()
  initAccent()
  initSidebars()
}

export const { store, system, state } = useColorMode({
  storageKey: "theme",
})

if (isTauri.value) {
  watch(store, (value) => {
    switch (value) {
      case "light":
        invoke("plugin:theme|set_theme", {
          theme: "light",
        })
        break
      case "dark":
        invoke("plugin:theme|set_theme", {
          theme: "dark",
        })
        break
      case "auto":
        invoke("plugin:theme|set_theme", {
          theme: "auto",
        })
        break
      default:
        invoke("plugin:theme|set_theme", {
          theme: "auto",
        })
        break
    }
  })
}
