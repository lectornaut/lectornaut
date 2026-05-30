import {
  hotkeyToDisplayKeys,
  IS_APPLE_DEVICE,
  SYSTEM_SHORTCUTS,
} from "@/helpers/shortcuts"
import { normalizeHotkeyFromEvent } from "@tanstack/vue-hotkeys"
import { nextTick, onScopeDispose, ref } from "vue"
import { toast } from "vue-sonner"

/**
 * Shared flag: `true` while any shortcut recorder is actively capturing keys.
 * `useGlobalHotkeys` reads this to mute global hotkeys during recording so the
 * captured combo doesn't also trigger an app action (replaces the imperative
 * `setHotkeysEnabled` toggle that the old hotkeys-js module exposed).
 */
export const isRecordingShortcut = ref(false)

export type ShortcutRecorderOptions = {
  /** Called with the final TanStack `Mod`-notation string (e.g. "Mod+K") */
  onRecord: (hotkeys: string) => void
}

export type ShortcutRecorderTarget =
  | EventTarget
  | HTMLElement
  | { $el?: HTMLElement | null }
  | null
  | undefined

const RECORDER_PLATFORM: "mac" | "windows" = IS_APPLE_DEVICE ? "mac" : "windows"

export const useShortcutRecorder = (options: ShortcutRecorderOptions) => {
  const isRecording = ref(false)
  const recorderInput = ref<HTMLInputElement | null>(null)

  // While recording, mute the global hotkeys (via the shared reactive flag) so
  // the keys being captured don't also trigger app actions.
  const suppressHotkeys = () => {
    if (isRecording.value) return

    isRecording.value = true
    isRecordingShortcut.value = true
  }

  const restoreHotkeys = () => {
    isRecording.value = false
    isRecordingShortcut.value = false
  }

  const resolveInputElement = (
    target?: ShortcutRecorderTarget
  ): HTMLInputElement | null => {
    const candidate =
      target && typeof target === "object" && "$el" in target
        ? (target.$el ?? null)
        : target

    if (
      typeof HTMLElement !== "undefined" &&
      candidate instanceof HTMLElement
    ) {
      if (candidate instanceof HTMLInputElement) {
        return candidate
      }

      return candidate.querySelector("input")
    }

    return recorderInput.value
  }

  const setRecorderInput = (target?: ShortcutRecorderTarget) => {
    const input = resolveInputElement(target)
    if (input) {
      recorderInput.value = input
    }
    return input
  }

  const startRecording = (target?: ShortcutRecorderTarget) => {
    const input = setRecorderInput(target)
    if (!input) return

    if (document.activeElement === input) {
      suppressHotkeys()
      return
    }

    nextTick(() => {
      input.focus()
    })
  }

  const stopRecording = () => {
    restoreHotkeys()
  }

  const handleRecorderFocus = (event: FocusEvent) => {
    setRecorderInput(event.currentTarget)
    suppressHotkeys()
  }

  const handleRecorderBlur = () => {
    restoreHotkeys()
  }

  const handleRecorderClick = (event: MouseEvent) => {
    startRecording(event.currentTarget)
  }

  onScopeDispose(() => {
    stopRecording()
  })

  const handleRecorderKeydown = (event: KeyboardEvent) => {
    const input = setRecorderInput(event.currentTarget)
    if (!isRecording.value && document.activeElement !== input) return

    event.preventDefault()
    event.stopPropagation()

    if (event.key === "Escape") {
      const currentTarget = event.currentTarget as HTMLInputElement | null
      currentTarget?.blur()
      stopRecording()
      return
    }

    // Ignore lone modifier presses
    if (["Control", "Shift", "Alt", "Meta", "OS"].includes(event.key)) {
      return
    }

    // Require at least one modifier
    if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      return
    }

    // Convert the keyboard event to a portable combo (e.g. ⌘K → "Mod+K").
    const hotkeyString = normalizeHotkeyFromEvent(event, RECORDER_PLATFORM)

    // System shortcuts are claimed by macOS and can't be reassigned. Only
    // enforced on Apple devices, where `Mod` resolves to ⌘ (the reserved key).
    if (IS_APPLE_DEVICE && SYSTEM_SHORTCUTS.has(hotkeyString)) {
      toast.error(
        `${hotkeyToDisplayKeys(hotkeyString).join("")} is reserved by the system`,
        { description: "Choose a different combination." }
      )
      return
    }

    options.onRecord(hotkeyString)
  }

  return {
    isRecording,
    startRecording,
    stopRecording,
    handleRecorderFocus,
    handleRecorderBlur,
    handleRecorderClick,
    handleRecorderKeydown,
  }
}
