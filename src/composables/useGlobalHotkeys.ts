import { isTauri } from "@/composables/usePlatform"
import { isRecordingShortcut } from "@/composables/useShortcutRecorder"
import {
  getFilteredShortcuts,
  getHotkeyCombos,
  getShortcutId,
} from "@/helpers/shortcuts"
import { emitter } from "@/modules/mitt"
import { useShortcutsStore } from "@/stores/shortcutsStore"
import { useHotkeys, type Hotkey } from "@tanstack/vue-hotkeys"
import { storeToRefs } from "pinia"
import { computed } from "vue"

/**
 * Registers every global application hotkey with TanStack's `HotkeyManager` and
 * keeps the registrations in sync, reactively. Call once from a long-lived root
 * component (`App.vue`); registrations are torn down when it unmounts.
 *
 * - The definition list is a `computed` over the user's shortcut overrides and
 *   the platform, so changing an override re-diffs registrations automatically
 *   (no manual teardown/rebind cycle).
 * - `enabled` is muted while a shortcut is being recorded, so the captured keys
 *   don't also fire an app action.
 * - `ignoreInputs` preserves the previous hotkeys-js behaviour: global hotkeys
 *   don't fire while typing in an editable input/textarea/contenteditable.
 * - `meta.name` labels each registration for the TanStack devtools panel and
 *   `useHotkeyRegistrations()`.
 */
export const useGlobalHotkeys = () => {
  const { shortcutOverrides } = storeToRefs(useShortcutsStore())

  const definitions = computed(() =>
    getFilteredShortcuts({ context: "hotkeys", isDesktop: isTauri.value })
      .flatMap((category) => category.shortcuts)
      .flatMap((shortcut) => {
        // Resolve effective binding: user override takes precedence. Combos of
        // length 0 (unbound, or an explicit "" override) contribute nothing.
        const binding =
          shortcutOverrides.value[getShortcutId(shortcut)] ?? shortcut.hotkeys
        return getHotkeyCombos(binding).map((combo) => ({
          // Cast: definitions may carry escape-hatch combos (e.g. "Shift+/")
          // outside the type-safe `Hotkey` union; they are valid at runtime.
          hotkey: combo as Hotkey,
          callback: () => emitter.emit(shortcut.event, shortcut.parameters),
          options: { meta: { name: shortcut.description.join(" › ") } },
        }))
      })
  )

  useHotkeys(definitions, {
    // Match hotkeys-js's default filter: don't fire while the user is typing in
    // an editable input/textarea/contenteditable.
    ignoreInputs: true,
    // Mute every global hotkey while a shortcut recorder is capturing keys.
    enabled: () => !isRecordingShortcut.value,
  })
}
