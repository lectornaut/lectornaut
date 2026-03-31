import {
  hotkeyToDisplayKeys,
  SYSTEM_SHORTCUTS,
  toCrossPlatformHotkeys,
} from "@/helpers/shortcuts"
import hotkeys from "hotkeys-js"
import { nextTick, onScopeDispose, ref } from "vue"
import { toast } from "vue-sonner"

export type ShortcutRecorderOptions = {
  /** Called with the final hotkeys-js string when a valid combo is recorded */
  onRecord: (hotkeys: string) => void
}

export type ShortcutRecorderTarget =
  | EventTarget
  | HTMLElement
  | { $el?: HTMLElement | null }
  | null
  | undefined

export const useShortcutRecorder = (options: ShortcutRecorderOptions) => {
  const isRecording = ref(false)
  const recorderInput = ref<HTMLInputElement | null>(null)

  let previousFilter: typeof hotkeys.filter | null = null

  const setHotkeyFilter = () => {
    if (isRecording.value) return

    isRecording.value = true
    previousFilter = hotkeys.filter
    hotkeys.filter = () => false
  }

  const restoreHotkeyFilter = () => {
    isRecording.value = false

    if (previousFilter) {
      hotkeys.filter = previousFilter
      previousFilter = null
    }
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
      setHotkeyFilter()
      return
    }

    nextTick(() => {
      input.focus()
    })
  }

  const stopRecording = () => {
    restoreHotkeyFilter()
  }

  const handleRecorderFocus = (event: FocusEvent) => {
    setRecorderInput(event.currentTarget)
    setHotkeyFilter()
  }

  const handleRecorderBlur = () => {
    restoreHotkeyFilter()
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

    const parts: string[] = []
    if (event.metaKey) parts.push("cmd")
    if (event.ctrlKey) parts.push("ctrl")
    if (event.altKey) parts.push("alt")
    if (event.shiftKey) parts.push("shift")

    parts.push(event.key.toLowerCase())

    const hotkeyString = parts.join("+")

    if (SYSTEM_SHORTCUTS.has(hotkeyString)) {
      toast.error(
        `${hotkeyToDisplayKeys(hotkeyString).join("")} is reserved by the system`,
        { description: "Choose a different combination." }
      )
      return
    }

    options.onRecord(toCrossPlatformHotkeys(hotkeyString))
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
