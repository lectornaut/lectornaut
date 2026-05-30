import { useSettingsStore } from "@/stores/settingsStore"
import { useSpeechRecognition } from "@vueuse/core"
import { storeToRefs } from "pinia"
import { computed, watch, type Ref } from "vue"

/**
 * Voice dictation into a text model via the Web Speech API.
 *
 * Appends recognized speech to `target` live: interim words update in
 * place, finalized phrases stick. Unlike read-aloud this is NOT a module
 * singleton — each call owns its own `SpeechRecognition`, scoped to (and
 * auto-stopped on unmount of) the component that dictates.
 *
 * ── Why we accumulate ourselves ─────────────────────────────────────────
 * VueUse's `result` holds only the CURRENT recognition segment — when the
 * next phrase begins it's *replaced*, so earlier finalized text disappears
 * from `result`. We therefore keep finalized phrases in `committed` and
 * re-render `base + committed + interim` on every update. `base` is
 * whatever was already in the field when dictation started, so speech is
 * appended rather than overwriting the user's text.
 */

// Join two fragments with exactly one separating space (unless the left
// side already ends in whitespace). Keeps "base", committed phrases and
// the interim tail from running together.
const appendPhrase = (existing: string, addition: string): string => {
  if (!addition) return existing
  if (!existing) return addition
  return /\s$/.test(existing) ? existing + addition : `${existing} ${addition}`
}

export function useDictation(target: Ref<string>) {
  const { isSupported, isListening, isFinal, result, start, stop } =
    useSpeechRecognition({
      continuous: true,
      interimResults: true,
      // System language is the best guess for what the user will speak;
      // falls back to VueUse's own "en-US" default if unavailable.
      lang: typeof navigator !== "undefined" ? navigator.language : "en-US",
    })

  // Dictation can be switched off in Preferences. Folding that into
  // `isAvailable` lets the mic button hide when it's unsupported OR disabled,
  // and the `startDictation` guard stops it being triggered another way.
  const { dictationEnabled } = storeToRefs(useSettingsStore())
  const isAvailable = computed(
    () => isSupported.value && dictationEnabled.value
  )

  // Text present before dictation began (we append, never overwrite) and
  // the finalized phrases captured so far this session.
  let base = ""
  let committed = ""

  watch(result, (transcript) => {
    // Ignore trailing results that arrive after stop() — VueUse flips
    // `isListening` false synchronously, so this guard prevents a late
    // final from repopulating a field we've since cleared (e.g. on send).
    if (!isListening.value) return
    if (isFinal.value) {
      committed = appendPhrase(committed, transcript)
      target.value = appendPhrase(base, committed)
    } else {
      target.value = appendPhrase(appendPhrase(base, committed), transcript)
    }
  })

  const startDictation = () => {
    if (!isAvailable.value) return
    base = target.value
    committed = ""
    start()
  }

  const stopDictation = () => stop()

  const toggleDictation = () => {
    if (isListening.value) stopDictation()
    else startDictation()
  }

  return {
    isSupported,
    isAvailable,
    isListening,
    startDictation,
    stopDictation,
    toggleDictation,
  }
}
