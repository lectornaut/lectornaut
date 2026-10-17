import { useCreateActions } from "@/composables/useCreateActions"
import { isRecordingShortcut } from "@/composables/useShortcutRecorder"
import { defaultMenu } from "@/helpers/defaults"
import { SEQUENCE_TIMEOUT } from "@/helpers/shortcuts"
import { useHotkeys, type HotkeySequence } from "@tanstack/vue-hotkeys"
import { computed } from "vue"
import { useRouter } from "vue-router"

/**
 * Registers the app's Vim/Linear-style multi-key sequences — "go to <page>"
 * (`G` then the page's letter) and "create <thing>" (`C` then the intent's
 * letter) — with TanStack's singleton hotkey manager. Call once from a
 * long-lived root component (`App.vue`); registrations tear down on unmount.
 *
 * The two surfaces that already describe these actions stay the single source
 * of truth, exactly as the ⌘K palette composes them:
 *   - destinations + their `sequence` come from `defaultMenu`
 *   - create intents + their `sequence` come from `useCreateActions`, which
 *     also tells us which are disabled (no permission / no workspace) so we
 *     never bind an action the user can't perform
 *
 * Mirrors `useGlobalHotkeys`:
 *   - definitions are a `computed`, so toggling a permission re-diffs the
 *     create registrations automatically (no manual teardown/rebind)
 *   - `ignoreInputs` keeps sequences from firing while typing in an editor /
 *     input / contenteditable (so `G` in a document is just a `G`)
 *   - `enabled` is muted while a shortcut is being recorded
 *   - `timeout` bounds the gap between the leading key and the next one
 */
export const useGlobalHotkeySequences = () => {
  const router = useRouter()
  const { groups: createGroups } = useCreateActions()

  const definitions = computed(() => {
    // "Go to" — navigate the current tab; the route ⇄ tab sync reuses or opens
    // a tab as usual (identical to the palette's navigate command).
    const navigate = defaultMenu.map((item) => ({
      // The spread converts the readonly tuple to a mutable hotkey sequence.
      hotkey: [...item.sequence] as HotkeySequence,
      callback: () => {
        void router.push(item.url)
      },
      options: {
        timeout: SEQUENCE_TIMEOUT,
        meta: { name: `Go to ${item.title}` },
      },
    }))

    // "Create" — same gated intents the palette offers, minus the disabled ones.
    const create = createGroups.value
      .flatMap((group) => group.actions)
      .filter((action) => !action.disabled)
      .map((action) => ({
        hotkey: action.sequence as HotkeySequence,
        callback: () => {
          void action.run()
        },
        options: {
          timeout: SEQUENCE_TIMEOUT,
          meta: { name: `Create: ${action.label}` },
        },
      }))

    return [...navigate, ...create]
  })

  useHotkeys(definitions, {
    // Don't fire while typing in an editable input/textarea/contenteditable.
    ignoreInputs: true,
    // Mute every sequence while a shortcut recorder is capturing keys.
    enabled: () => !isRecordingShortcut.value,
  })
}
