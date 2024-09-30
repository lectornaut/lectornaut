import { shortcuts } from "@/helpers/shortcuts"
import emitter from "@/modules/mitt"
import hotkeys from "hotkeys-js"

export const initHotkeys = () => {
  shortcuts
    .filter((category) => category.shortcuts.length > 0)
    .filter((category) => !category.hidden.includes("shortcuts"))
    .forEach((category) => {
      category.shortcuts.forEach((shortcut) => {
        hotkeys(shortcut.hotkeys, (event) => {
          event.preventDefault()
          emitter.emit(shortcut.event, shortcut.parameters)
        })
      })
    })
}
