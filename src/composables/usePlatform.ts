import type { UnlistenFn } from "@tauri-apps/api/event"
import {
  getCurrentWindow,
  type Window as TauriWindow,
} from "@tauri-apps/api/window"
import type { Ref } from "vue"

type TauriWindowMetadata = {
  currentWindow?: {
    label?: string
  }
}

type TauriInternals = {
  invoke?: unknown
  metadata?: TauriWindowMetadata
}

const getTauriInternals = (): TauriInternals | null => {
  if (typeof window === "undefined") return null

  const internals = (
    window as typeof window & {
      __TAURI_INTERNALS__?: TauriInternals
    }
  ).__TAURI_INTERNALS__

  if (!internals || typeof internals !== "object") return null

  return internals
}

/**
 * Whether the app is running in Tauri (desktop) environment.
 * This is a computed ref that can be used reactively.
 */
export const isTauri = computed(() =>
  Boolean(
    typeof getTauriInternals()?.invoke === "function" &&
    getTauriInternals()?.metadata?.currentWindow?.label
  )
)

/**
 * Whether the app is running in a browser environment.
 */
export const isBrowser = computed(() => !isTauri.value)

/**
 * Detected operating system.
 */
export const platform = computed(() => {
  if (typeof navigator === "undefined") return "unknown"
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes("mac")) return "macos"
  if (ua.includes("win")) return "windows"
  if (ua.includes("linux")) return "linux"
  if (ua.includes("android")) return "android"
  if (ua.includes("iphone") || ua.includes("ipad")) return "ios"
  return "unknown"
})

// Global fullscreen state
const isFullscreenState = shallowRef(false)
let unlisten: UnlistenFn | undefined
let listenerInitialized = false

export const getCurrentTauriWindow = (): TauriWindow | null => {
  if (!isTauri.value) return null

  try {
    return getCurrentWindow()
  } catch {
    return null
  }
}

const initFullscreenListener = async (): Promise<void> => {
  // Only initialize once and only in Tauri environment
  if (listenerInitialized || !isTauri.value) return
  listenerInitialized = true

  try {
    const win = getCurrentTauriWindow()
    if (!win) {
      listenerInitialized = false
      return
    }

    isFullscreenState.value = await win.isFullscreen()
    unlisten = await win.onResized(async () => {
      isFullscreenState.value = await win.isFullscreen()
    })
  } catch (e) {
    console.error("Failed to setup fullscreen listener:", e)
    listenerInitialized = false // Allow retry on error
  }
}

/**
 * Composable for tracking fullscreen state in Tauri.
 * Automatically initializes the listener on mount.
 * @returns Reactive ref indicating fullscreen state.
 */
export function useIsFullscreen(): Readonly<Ref<boolean>> {
  onMounted(() => {
    initFullscreenListener()
  })

  return readonly(isFullscreenState)
}

/**
 * Toggle fullscreen mode in Tauri.
 * No-op in browser environment.
 */
export async function toggleFullscreen(): Promise<void> {
  if (!isTauri.value) return

  try {
    const win = getCurrentTauriWindow()
    if (!win) return

    const isFullscreen = await win.isFullscreen()
    await win.setFullscreen(!isFullscreen)
    isFullscreenState.value = !isFullscreen
  } catch (e) {
    console.error("Failed to toggle fullscreen:", e)
  }
}

/**
 * Cleanup function for fullscreen listener.
 * Call this when the app is being destroyed.
 */
export function cleanupPlatformListeners(): void {
  if (unlisten) {
    unlisten()
    unlisten = undefined
    listenerInitialized = false
  }
}
