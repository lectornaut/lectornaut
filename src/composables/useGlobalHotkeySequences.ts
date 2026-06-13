import { useCreateActions } from "@/composables/useCreateActions"
import { isRecordingShortcut } from "@/composables/useShortcutRecorder"
import { defaultMenu } from "@/helpers/defaults"
import { SEQUENCE_TIMEOUT } from "@/helpers/shortcuts"
import { useHotkeySequences, type Hotkey } from "@tanstack/vue-hotkeys"
import { computed } from "vue"
import { useRouter } from "vue-router"

/**
 * Registers the app's Vim/Linear-style multi-key sequences — "go to <page>"
 * (`G` then the page's letter) and "create <thing>" (`C` then the intent's
 * letter) — with TanStack's singleton `SequenceManager`. Call once from a
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
      // Literal letter tuples are valid `Hotkey`s; the spread drops `readonly`.
      sequence: [...item.sequence] as Hotkey[],
      callback: () => {
        void router.push(item.url)
      },
      options: { meta: { name: `Go to ${item.title}` } },
    }))

    // "Create" — same gated intents the palette offers, minus the disabled ones.
    const create = createGroups.value
      .flatMap((group) => group.actions)
      .filter((action) => !action.disabled)
      .map((action) => ({
        sequence: action.sequence as Hotkey[],
        callback: () => {
          void action.run()
        },
        options: { meta: { name: `Create: ${action.label}` } },
      }))

    return [...navigate, ...create]
  })

  useHotkeySequences(definitions, {
    // Don't fire while typing in an editable input/textarea/contenteditable.
    ignoreInputs: true,
    // Reset the in-progress sequence after this idle gap between keys.
    timeout: SEQUENCE_TIMEOUT,
    // Mute every sequence while a shortcut recorder is capturing keys.
    enabled: () => !isRecordingShortcut.value,
  })
}
