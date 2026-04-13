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
let initPromise: Promise<void> | null = null

export const getCurrentTauriWindow = (): TauriWindow | null => {
  if (!isTauri.value) return null

  try {
    return getCurrentWindow()
  } catch {
    return null
  }
}

const initFullscreenListener = (): void => {
  if (initPromise || unlisten || !isTauri.value) return

  initPromise = (async () => {
    const win = getCurrentTauriWindow()
    if (!win) return

    isFullscreenState.value = await win.isFullscreen()
    unlisten = await win.onResized(async () => {
      isFullscreenState.value = await win.isFullscreen()
    })
  })()
    .catch((e) => {
      console.error("Failed to setup fullscreen listener:", e)
    })
    .finally(() => {
      initPromise = null
    })
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
 * Update the app badge count on the app icon.
 * Uses Tauri's window API in desktop, or the Badging API in PWA/browser.
 * Passing 0 or null clears the badge.
 */
export async function setBadgeCount(count: number | null): Promise<void> {
  const hasCount = count != null && count > 0

  try {
    if (isTauri.value) {
      const win = getCurrentTauriWindow()
      if (!win) return

      await win.setBadgeCount(hasCount ? count : undefined)
    } else if (navigator.setAppBadge) {
      if (hasCount) {
        await navigator.setAppBadge(count)
      } else {
        await navigator.clearAppBadge()
      }
    }
  } catch (e) {
    console.error("Failed to set badge count:", e)
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
  }
}
