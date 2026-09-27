import { isMainTauriWindow, isTauri } from "@/composables/usePlatform"
import { emitTo, listen } from "@tauri-apps/api/event"
import mitt from "mitt"

/**
 * Global Event Emitter
 * Used for cross-component communication, especially for hotkeys
 */
export const emitter = mitt()

const MAIN_WINDOW_INTENT_EVENT = "lectornaut:main-window-intent"

interface MainWindowIntent {
  name: string
  payload: unknown
}

export const emitMainWindowIntent = (
  name: string,
  payload?: unknown
): Promise<void> => {
  if (!isTauri.value || isMainTauriWindow.value) {
    emitter.emit(name, payload)
    return Promise.resolve()
  }

  return emitTo("main", MAIN_WINDOW_INTENT_EVENT, { name, payload })
}

export const listenForMainWindowIntents = () => {
  if (!isMainTauriWindow.value) return Promise.resolve(() => {})

  return listen<MainWindowIntent>(MAIN_WINDOW_INTENT_EVENT, ({ payload }) => {
    emitter.emit(payload.name, payload.payload)
  })
}
