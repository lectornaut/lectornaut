import {
  getHotkeyCombos,
  getShortcutById,
  getShortcutDisplayKeys,
  hotkeyToDisplayKeys,
} from "@/helpers/shortcuts"
import { useShortcutsStore } from "@/stores/shortcutsStore"
import { storeToRefs } from "pinia"
import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from "vue"

/**
 * Resolve the displayable keys for a shortcut event id.
 *
 * Honors any user override from the shortcuts store; otherwise uses the
 * shortcut's canonical display — its explicit `keys` override, else derived
 * from `hotkeys` (`getShortcutDisplayKeys`). Returns `null` when the event has
 * no displayable keys (e.g. command-palette-only shortcuts).
 *
 * Accepts a plain string, a ref, or a getter. The id is resolved with
 * `toValue` *inside* the computed (along with the `getShortcutById` lookup),
 * so a reactive id re-resolves to a different shortcut when it changes —
 * previously the lookup was hoisted out and frozen to the first id passed.
 */
export const useShortcutKeys = (
  shortcutId: MaybeRefOrGetter<string>
): ComputedRef<string[] | null> => {
  const { shortcutOverrides } = storeToRefs(useShortcutsStore())

  return computed(() => {
    const id = toValue(shortcutId)
    const override = shortcutOverrides.value?.[id]
    if (override) {
      const firstCombo = getHotkeyCombos(override)[0]
      if (firstCombo) return hotkeyToDisplayKeys(firstCombo)
    }
    // No override: the canonical display (explicit `keys`, else derived from
    // `hotkeys`), first combo only.
    const shortcut = getShortcutById(id)
    return shortcut ? (getShortcutDisplayKeys(shortcut)[0] ?? null) : null
  })
}
