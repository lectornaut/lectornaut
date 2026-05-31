import {
  getHotkeyCombos,
  getShortcutById,
  hotkeyToDisplayKeys,
} from "@/helpers/shortcuts"
import { useSettingsStore } from "@/stores/settingsStore"
import { storeToRefs } from "pinia"
import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from "vue"

/**
 * Resolve the displayable keys for a shortcut event id.
 *
 * Honors any user override from the settings store; otherwise falls back to
 * the static `keys` defined on the shortcut. Returns `null` when the event
 * has no displayable keys (e.g. command-palette-only shortcuts).
 *
 * Accepts a plain string, a ref, or a getter. The id is resolved with
 * `toValue` *inside* the computed (along with the `getShortcutById` lookup),
 * so a reactive id re-resolves to a different shortcut when it changes —
 * previously the lookup was hoisted out and frozen to the first id passed.
 */
export const useShortcutKeys = (
  shortcutId: MaybeRefOrGetter<string>
): ComputedRef<string[] | null> => {
  const { shortcutOverrides } = storeToRefs(useSettingsStore())

  return computed(() => {
    const id = toValue(shortcutId)
    const override = shortcutOverrides.value?.[id]
    if (override) {
      const firstCombo = getHotkeyCombos(override)[0]
      if (firstCombo) return hotkeyToDisplayKeys(firstCombo)
    }
    return getShortcutById(id)?.keys?.[0] ?? null
  })
}
