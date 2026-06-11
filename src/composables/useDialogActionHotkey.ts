import { isRecordingShortcut } from "@/composables/useShortcutRecorder"
import { useHotkey } from "@tanstack/vue-hotkeys"

/**
 * App-level Enter-to-proceed for dialogs — call ONCE from `App.vue` (next to
 * `useGlobalHotkeys`). Gives every open dialog macOS-style "default button"
 * semantics: Enter activates the proceed button, Escape (reka-ui built-in)
 * stays the cancel key, Space keeps activating whichever button is focused.
 *
 * The proceed button is found by convention, inside the dialog the keystroke
 * originated from:
 *   1. `[data-dialog-action]`  — explicit marker, works in any dialog
 *   2. `[data-slot="alert-dialog-action"]` — shadcn ships this on every
 *      `AlertDialogAction`, so confirm dialogs work with no per-site marker
 *
 * This exists because reka-ui's AlertDialogContent focuses the CANCEL button
 * on open (WAI-ARIA "least destructive action"), so a bare Enter would
 * dismiss confirms instead of proceeding.
 *
 * Scoping is derived from the event itself: the keystroke must originate
 * inside an OPEN dialog (`closest('[role=dialog/alertdialog][data-state=open]')`).
 * Floating layers are safe by construction — Select/Dropdown/Popover content
 * portals under `<body>` with its own `role="dialog"` boundary, so keystrokes
 * there never resolve to the underlying dialog's action button.
 */
export function useDialogActionHotkey() {
  useHotkey(
    "Enter",
    (event) => {
      // A held-down key, an IME confirming composed text, or a control that
      // already handled Enter itself (e.g. an input with its own
      // `@keydown.enter.prevent`) is never a "proceed" intent.
      if (event.repeat || event.isComposing || event.defaultPrevented) return

      const origin = event.target instanceof HTMLElement ? event.target : null
      if (!origin) return

      const dialog = origin.closest<HTMLElement>(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
      )
      if (!dialog) return

      // Enter keeps its native meaning where it already has one: newline in
      // multi-line editors, navigation on links, opening popup triggers
      // (select/combobox/menu). Single-line inputs fall through on purpose —
      // Enter there mirrors implicit form submission.
      if (origin.isContentEditable) return
      if (
        origin.closest(
          'a[href], textarea, select, [aria-haspopup], [role="combobox"]'
        )
      ) {
        return
      }

      const action =
        dialog.querySelector<HTMLElement>("[data-dialog-action]") ??
        dialog.querySelector<HTMLElement>('[data-slot="alert-dialog-action"]')
      if (!action || action.matches(':disabled, [aria-disabled="true"]')) {
        return
      }

      // Exactly one deterministic outcome: suppress the focused control's
      // own Enter activation (reka focuses Cancel on open) and click the
      // proceed button instead.
      event.preventDefault()
      event.stopPropagation()
      action.click()
    },
    {
      // The library skips input-originated events for single-key hotkeys by
      // default; Enter-in-input is exactly the submit gesture we want, so
      // opt out and filter multi-line/popup controls in the callback above.
      ignoreInputs: false,
      // Applied manually in the callback, and only when the action actually
      // fires — a skipped event must keep its native behavior (e.g. a
      // focused Cancel button activating itself).
      preventDefault: false,
      stopPropagation: false,
      // Mirrors useGlobalHotkeys: don't fire while a shortcut is being
      // recorded in settings.
      enabled: () => !isRecordingShortcut.value,
      meta: { name: "Dialog › Confirm" },
    }
  )
}
