import type { UnlistenFn } from "@tauri-apps/api/event"
import { Image } from "@tauri-apps/api/image"
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
 * Draw a taskbar overlay badge (red disc, white count) for Windows, where
 * `setBadgeCount` is a no-op. Rendered at 32px so DWM downscaling to the
 * 16px overlay slot stays crisp on hidpi taskbars.
 */
async function renderBadgeOverlay(count: number): Promise<Image | undefined> {
  const size = 32
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")
  if (!ctx) return undefined

  ctx.fillStyle = "#e81123" // Windows notification-badge red
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  ctx.fill()

  const label = count > 9 ? "9+" : String(count)
  ctx.fillStyle = "#ffffff"
  ctx.font = `600 ${label.length > 1 ? 16 : 20}px system-ui, sans-serif`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  // +1: optical vertical centering — digits sit high of the metric middle
  // at this size, and the badge is far too small to eyeball in situ.
  ctx.fillText(label, size / 2, size / 2 + 1)

  const rgba = ctx.getImageData(0, 0, size, size).data
  return Image.new(new Uint8Array(rgba.buffer), size, size)
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

      // Windows has no numeric taskbar badge — paint the count onto an
      // overlay icon instead. Passing undefined clears it.
      if (platform.value === "windows") {
        await win.setOverlayIcon(
          hasCount ? await renderBadgeOverlay(count) : undefined
        )
        return
      }

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
