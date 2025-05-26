import {
  shortcuts,
  type Shortcut,
  type ShortcutCategory,
} from "@/helpers/shortcuts"
import { isTauri } from "@/helpers/utilities"
import emitter from "@/modules/mitt"
import hotkeys from "hotkeys-js"

export const initHotkeys = () => {
  const isWeb = !isTauri.value
  const isDesktop = isTauri.value

  const filterShortcut = (shortcut: Shortcut) =>
    (isWeb ? !shortcut.hidden.includes("web") : true) &&
    (isDesktop ? !shortcut.hidden.includes("desktop") : true) &&
    !shortcut.hidden.includes("shortcuts")

  const filterCategory = (category: ShortcutCategory) =>
    (isWeb ? !category.hidden.includes("web") : true) &&
    (isDesktop ? !category.hidden.includes("desktop") : true) &&
    !category.hidden.includes("shortcuts")

  shortcuts.filter(filterCategory).forEach((category) => {
    category.shortcuts.filter(filterShortcut).forEach((shortcut) => {
      if (shortcut.hotkeys) {
        hotkeys(shortcut.hotkeys, (event) => {
          event.preventDefault()
          emitter.emit(shortcut.event, shortcut.parameters)
        })
      }
    })
  })
}
