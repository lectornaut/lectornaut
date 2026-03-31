import { isTauri } from "@/composables/usePlatform"
import { getFilteredShortcuts, getShortcutId } from "@/helpers/shortcuts"
import { emitter } from "@/modules/mitt"
import hotkeys from "hotkeys-js"

/** Track all currently registered hotkey strings for teardown */
const registeredBindings = new Set<string>()

/**
 * Read shortcut overrides from localStorage (non-reactive, for use outside Vue).
 * Returns the override map or an empty object.
 */
const readOverrides = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem("shortcutOverrides")
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

/**
 * Initializes global hotkeys.
 * Filters shortcuts based on platform (Web/Desktop), applies user overrides,
 * and registers them using hotkeys-js.
 */
export const initHotkeys = () => {
  const overrides = readOverrides()

  const filteredShortcuts = getFilteredShortcuts({
    context: "hotkeys",
    isDesktop: isTauri.value,
  })

  filteredShortcuts.forEach((category) => {
    category.shortcuts.forEach((shortcut) => {
      // Resolve effective binding: user override takes precedence
      const binding = overrides[getShortcutId(shortcut)] ?? shortcut.hotkeys
      if (!binding) return

      // Empty string means the shortcut is disabled
      if (binding === "") return

      hotkeys(binding, (event) => {
        event.preventDefault()
        emitter.emit(shortcut.event, shortcut.parameters)
      })
      registeredBindings.add(binding)
    })
  })
}

/**
 * Unbinds all currently registered hotkeys.
 */
export const teardownHotkeys = () => {
  for (const binding of registeredBindings) {
    // hotkeys-js requires unbinding each comma-separated combo individually
    for (const combo of binding.split(",")) {
      hotkeys.unbind(combo.trim())
    }
  }
  registeredBindings.clear()
}

/**
 * Teardown existing bindings and re-register with current overrides.
 * Call this when shortcutOverrides change.
 */
export const rebindHotkeys = () => {
  teardownHotkeys()
  initHotkeys()
}
