import { isTauri } from "@/composables/usePlatform"
import { useClipboard } from "@vueuse/core"
import type { MaybeRefOrGetter } from "vue"

// Single source of truth for clipboard writes. Every copy action in the app
// goes through here: the web build rides VueUse's `useClipboard` (async
// clipboard API with an execCommand fallback for non-secure contexts), while
// the desktop build calls tauri-plugin-clipboard-manager — webview clipboard
// APIs are unreliable on webkit2gtk (Linux), the native plugin is not.
// Do not call `useClipboard` or `navigator.clipboard` directly elsewhere.

// Module-scope instance is safe: with `read` off, VueUse registers no
// lifecycle hooks or event listeners here.
const webClipboard = useClipboard({ legacy: true })

/** Write plain text to the system clipboard (bare, stateless seam). */
export async function copyText(text: string): Promise<void> {
  if (isTauri.value) {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager")
    await writeText(text)
    return
  }
  await webClipboard.copy(text)
}

type UseCopyOptions = {
  /** Text to copy when `copy()` is called without an argument. */
  source?: MaybeRefOrGetter<string>
  /** How long `copied` stays true after a successful write, in ms. */
  copiedDuring?: number
}

/**
 * Stateful wrapper over {@link copyText} mirroring the VueUse `useClipboard`
 * shape the call sites were built on: `copy(text?)` plus a `copied` flag that
 * self-resets after ~1.5s. Unlike VueUse the flag is per-instance state, so
 * two instances in one component never share a check-mark.
 */
export function useCopy(options: UseCopyOptions = {}) {
  const { source, copiedDuring = 1500 } = options

  const copied = shallowRef(false)
  let resetTimer: ReturnType<typeof setTimeout> | undefined

  const copy = async (text?: string): Promise<void> => {
    const value = text ?? (source !== undefined ? toValue(source) : undefined)
    if (value == null) return

    await copyText(value)

    copied.value = true
    clearTimeout(resetTimer)
    resetTimer = setTimeout(() => {
      copied.value = false
    }, copiedDuring)
  }

  return { copy, copied }
}
