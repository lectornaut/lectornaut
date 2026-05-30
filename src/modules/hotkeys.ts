import { isTauri } from "@/composables/usePlatform"
import {
  getFilteredShortcuts,
  getHotkeyCombos,
  getShortcutId,
} from "@/helpers/shortcuts"
import { emitter } from "@/modules/mitt"
import { parseSafe } from "@/schemas/_utils"
import { shortcutOverridesSchema } from "@/schemas/settings"
import {
  getHotkeyManager,
  type Hotkey,
  type HotkeyRegistrationHandle,
} from "@tanstack/vue-hotkeys"

/** Handles for every currently registered global hotkey (teardown + toggling). */
const registrations: HotkeyRegistrationHandle[] = []

/**
 * Read shortcut overrides from localStorage (non-reactive, for use outside Vue).
 * Returns the override map or an empty object. Validates the cached entry
 * via `parseSafe` so corrupt or tampered cache falls back to an empty map
 * instead of poisoning the hotkey system with malformed bindings.
 */
const readOverrides = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem("shortcutOverrides")
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return parseSafe(shortcutOverridesSchema, parsed, "hotkeys.overrides") ?? {}
  } catch {
    return {}
  }
}

/**
 * Initializes global hotkeys.
 * Filters shortcuts based on platform (Web/Desktop), applies user overrides,
 * and registers them with TanStack's singleton `HotkeyManager`.
 */
export const initHotkeys = () => {
  const overrides = readOverrides()
  const manager = getHotkeyManager()

  const filteredShortcuts = getFilteredShortcuts({
    context: "hotkeys",
    isDesktop: isTauri.value,
  })

  filteredShortcuts.forEach((category) => {
    category.shortcuts.forEach((shortcut) => {
      // Resolve effective binding: user override takes precedence. A combo list
      // of length 0 means the shortcut is unbound or explicitly disabled ("").
      const binding = overrides[getShortcutId(shortcut)] ?? shortcut.hotkeys
      const combos = getHotkeyCombos(binding)
      if (combos.length === 0) return

      for (const combo of combos) {
        const handle = manager.register(
          // Cast: definitions may carry escape-hatch combos (e.g. "Shift+/")
          // outside the type-safe `Hotkey` union; they are valid at runtime.
          combo as Hotkey,
          () => emitter.emit(shortcut.event, shortcut.parameters),
          {
            // Match hotkeys-js's default filter: don't fire while the user is
            // typing in an editable input/textarea/contenteditable.
            ignoreInputs: true,
            // conflictBehavior defaults to "warn": app bindings are unique, so
            // a future accidental duplicate (or a colliding legacy override)
            // surfaces in the console instead of silently double-firing.
          }
        )
        registrations.push(handle)
      }
    })
  })
}

/**
 * Unbinds all currently registered hotkeys.
 */
export const teardownHotkeys = () => {
  for (const handle of registrations) {
    handle.unregister()
  }
  registrations.length = 0
}

/**
 * Teardown existing bindings and re-register with current overrides.
 * Call this when shortcutOverrides change.
 */
export const rebindHotkeys = () => {
  teardownHotkeys()
  initHotkeys()
}

/**
 * Enable or disable all global hotkeys without unregistering them. Used by the
 * shortcut recorder to suppress hotkeys while the user captures a new combo
 * (replaces hotkeys-js's `hotkeys.filter = () => false`).
 */
export const setHotkeysEnabled = (enabled: boolean) => {
  for (const handle of registrations) {
    handle.setOptions({ enabled })
  }
}
