import type { UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"

export const isTauri = computed(() => "__TAURI_INTERNALS__" in window)

const isFullscreenState = ref(false)
let unlisten: UnlistenFn | undefined

const initFullscreenListener = async () => {
  if (unlisten || !isTauri.value) return

  try {
    const win = getCurrentWindow()
    isFullscreenState.value = await win.isFullscreen()
    unlisten = await win.onResized(async () => {
      isFullscreenState.value = await win.isFullscreen()
    })
  } catch (e) {
    console.error("Failed to setup fullscreen listener:", e)
  }
}

export const useIsFullscreen = () => {
  onMounted(() => {
    initFullscreenListener()
  })

  return isFullscreenState
}
