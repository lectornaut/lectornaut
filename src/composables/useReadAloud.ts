import { useSpeechSynthesis } from "@vueuse/core"
import { ref, shallowRef } from "vue"

/**
 * App-wide read-aloud (text-to-speech) over the Web Speech API.
 *
 * State lives at module scope — the same singleton pattern as the
 * fullscreen/badge state in `usePlatform` — so there is only ever ONE
 * utterance speaking across the whole app, no matter how many components
 * call `useReadAloud()`. That exclusivity is the point: starting a new
 * read implicitly stops whatever was reading before, because VueUse's
 * `speak()` calls `synth.cancel()` first. A per-component instance
 * couldn't make that guarantee.
 *
 * Works in both build targets — `speechSynthesis` exists in the browser
 * PWA and in Tauri's WebView — so no `isTauri` branch is needed here.
 */

// The text currently handed to the synthesizer. `shallowRef`: it's a
// flat string, no need to deep-proxy it.
const spokenText = shallowRef("")

// Which message bubble owns the current read. Drives the per-message
// menu state (Read aloud ↔ Pause/Stop ↔ Resume).
//
// Deliberately NOT cleared when a read ends naturally: the `status` flip
// to "end" is enough for the menu to fall back to "Read aloud", and
// clearing it on end would race a back-to-back `readAloud()` that has
// already claimed a new id — `speak()`'s `cancel()` fires the *previous*
// utterance's `onend` asynchronously, after the new id is set. Only an
// explicit `stop()` releases the id.
const activeId = ref<string | null>(null)

// One synthesizer for the whole app. VueUse v14 exposes pause/resume
// only indirectly: a `watch(isPlaying)` calls `synth.pause()` /
// `synth.resume()` when the flag flips, and `toggle(value)` is what
// flips it. So pause = `toggle(false)`, resume = `toggle(true)`.
// `status` cycles 'init' → 'play' → 'pause' → 'end'.
const speech = useSpeechSynthesis(spokenText, {
  rate: 1,
  pitch: 1,
  volume: 1,
})

export function useReadAloud() {
  const isSupported = speech.isSupported

  /** Actively speaking *this* message (not paused, not ended). */
  const isSpeaking = (id: string) =>
    activeId.value === id && speech.status.value === "play"

  /** Paused mid-read on *this* message. */
  const isPaused = (id: string) =>
    activeId.value === id && speech.status.value === "pause"

  /**
   * Start reading `text` aloud for message `id`. No-op when the API is
   * unsupported or the text is blank. Any in-flight read is cancelled by
   * `speak()`, so the new message simply takes over the one synthesizer.
   */
  const readAloud = (id: string, text: string) => {
    const trimmed = text.trim()
    if (!isSupported.value || !trimmed) return
    spokenText.value = trimmed
    activeId.value = id
    // `speak()` reads the `utterance` computed, which the `spokenText`
    // change above just invalidated — so it rebuilds the utterance with
    // the new text (and cancels the previous one) before speaking.
    speech.speak()
  }

  /** Pause the current read; resumable via `resume()`. */
  const pause = () => speech.toggle(false)

  /** Resume a paused read. */
  const resume = () => speech.toggle(true)

  /** Stop the current read entirely and release the active bubble. */
  const stop = () => {
    speech.stop()
    activeId.value = null
  }

  return { isSupported, isSpeaking, isPaused, readAloud, pause, resume, stop }
}
