import {
  getHotkeyCombos,
  getShortcutById,
  hotkeyToDisplayKeys,
} from "@/helpers/shortcuts"
import { useSettingsStore } from "@/stores/settingsStore"
import { storeToRefs } from "pinia"
import { computed, type ComputedRef } from "vue"

/**
 * Resolve the displayable keys for a shortcut event id.
 *
 * Honors any user override from the settings store; otherwise falls back to
 * the static `keys` defined on the shortcut. Returns `null` when the event
 * has no displayable keys (e.g. command-palette-only shortcuts).
 */
export const useShortcutKeys = (
  shortcutId: string
): ComputedRef<string[] | null> => {
  const { shortcutOverrides } = storeToRefs(useSettingsStore())
  const shortcut = getShortcutById(shortcutId)

  return computed(() => {
    const override = shortcutOverrides.value?.[shortcutId]
    if (override) {
      const firstCombo = getHotkeyCombos(override)[0]
      if (firstCombo) return hotkeyToDisplayKeys(firstCombo)
    }
    return shortcut?.keys?.[0] ?? null
  })
}
