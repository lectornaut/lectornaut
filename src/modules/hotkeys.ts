import { isTauri } from "@/composables/usePlatform"
import { getFilteredShortcuts } from "@/helpers/shortcuts"
import { emitter } from "@/modules/mitt"
import hotkeys from "hotkeys-js"

/**
 * Initializes global hotkeys
 * Filters shortcuts based on platform (Web/Desktop) and registers them using hotkeys-js
 */
export const initHotkeys = () => {
  const filteredShortcuts = getFilteredShortcuts({
    context: "hotkeys",
    isDesktop: isTauri.value,
  })

  filteredShortcuts.forEach((category) => {
    category.shortcuts.forEach((shortcut) => {
      if (shortcut.hotkeys) {
        hotkeys(shortcut.hotkeys, (event) => {
          event.preventDefault()
          emitter.emit(shortcut.event, shortcut.parameters)
        })
      }
    })
  })
}
