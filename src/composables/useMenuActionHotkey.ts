import { isRecordingShortcut } from "@/composables/useShortcutRecorder"
import { useEventListener } from "@vueuse/core"

/**
 * App-level accelerators for menu items — call ONCE from `App.vue` (next to
 * `useDialogActionHotkey`). While a dropdown / context menu is open, a bare
 * keystroke activates the item that declares it via a `data-hotkey` marker:
 *
 *   <DropdownMenuItem data-hotkey="r" @click="rename">
 *     {{ t("actions.rename") }}
 *     <DropdownMenuShortcut>R</DropdownMenuShortcut>
 *   </DropdownMenuItem>
 *
 * `data-hotkey` is the binding; `DropdownMenuShortcut` stays the visible
 * hint. Combos are lowercase `modifier+key` tokens ("r", "shift+n");
 * whitespace separates alternative bindings for one item ("backspace delete"
 * — macOS ⌫ and the Windows Delete key).
 *
 * House vocabulary, so the same verb earns the same key in every menu:
 * E edit · R rename / run · A archive + restore / approve · ⌫ delete ·
 * X reject / exit / remove / disconnect · P pin · S share · C connect / copy.
 *
 * Scoping is derived from the event itself (the `useDialogActionHotkey`
 * pattern): the keystroke must originate inside an OPEN `role="menu"`, and
 * only that menu's items are searched. reka-ui makes this airtight —
 * dropdowns are modal and focus their content on open, so every keystroke
 * while a menu is open originates inside it; submenu content portals
 * separately with its own `role="menu"`, so an open submenu shadows its
 * parent instead of double-matching.
 *
 * Dispatch is a DOM `click()` on the item, which reka routes through its
 * normal select pipeline — `@click` and `@select` handlers, `@select.prevent`
 * keep-open semantics, `as-child` links, and embedded `AlertDialogTrigger`s
 * all behave exactly as a pointer click, and the menu dismisses itself. The
 * listener runs in the CAPTURE phase so a matched key never doubles as
 * reka's first-letter typeahead (which would move focus right as the menu
 * closes); unmatched keys fall through and keep typeahead intact.
 */

const MODIFIER_ALIASES: Record<string, "meta" | "ctrl" | "alt" | "shift"> = {
  meta: "meta",
  cmd: "meta",
  command: "meta",
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  shift: "shift",
}

const MODIFIER_ORDER = ["meta", "ctrl", "alt", "shift"] as const

/** Canonical form of one combo ("N+shift" → "shift+n") so authoring order
 *  and modifier spelling never matter. `null` for a modifier-only combo. */
const normalizeCombo = (combo: string): string | null => {
  const modifiers = new Set<string>()
  let key: string | null = null
  for (const token of combo.split("+")) {
    const part = token.trim().toLowerCase()
    if (!part) continue
    const modifier = MODIFIER_ALIASES[part]
    if (modifier) modifiers.add(modifier)
    else key = part
  }
  if (!key) return null
  return [
    ...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)),
    key,
  ].join("+")
}

/** The pressed combo in the same canonical form; `null` while only a
 *  modifier is down. */
const comboFromEvent = (event: KeyboardEvent): string | null => {
  const key = event.key.toLowerCase()
  if (MODIFIER_ALIASES[key]) return null
  const parts: string[] = []
  if (event.metaKey) parts.push("meta")
  if (event.ctrlKey) parts.push("ctrl")
  if (event.altKey) parts.push("alt")
  if (event.shiftKey) parts.push("shift")
  parts.push(key === " " ? "space" : key)
  return parts.join("+")
}

export function useMenuActionHotkey() {
  useEventListener(
    document,
    "keydown",
    (event) => {
      // A held-down key or an IME composing text is never an accelerator;
      // neither is any keystroke while settings is recording a shortcut.
      if (event.repeat || event.isComposing) return
      if (isRecordingShortcut.value) return

      const combo = comboFromEvent(event)
      if (!combo) return

      const origin = event.target instanceof HTMLElement ? event.target : null
      if (!origin) return

      // Typing surfaces keep their keystrokes — a search field or other
      // editable control rendered inside a menu must not lose letters to
      // accelerators.
      if (
        origin.isContentEditable ||
        origin.closest("input, textarea, select")
      ) {
        return
      }

      const menu = origin.closest<HTMLElement>(
        '[role="menu"][data-state="open"]'
      )
      if (!menu) return

      const item = Array.from(
        menu.querySelectorAll<HTMLElement>("[data-hotkey]")
      ).find(
        (candidate) =>
          !candidate.matches(
            ':disabled, [aria-disabled="true"], [data-disabled]'
          ) &&
          (candidate.dataset.hotkey ?? "")
            .split(/\s+/)
            .some((alternative) => normalizeCombo(alternative) === combo)
      )
      if (!item) return

      // Exactly one deterministic outcome: the keystroke becomes the item's
      // activation, never also typeahead or a global hotkey.
      event.preventDefault()
      event.stopPropagation()
      item.click()
    },
    { capture: true }
  )
}
