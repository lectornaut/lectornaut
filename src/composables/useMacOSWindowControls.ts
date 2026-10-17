import { isTauri, platform, useIsFullscreen } from "@/composables/usePlatform"
import { invoke } from "@tauri-apps/api/core"
import { useEventListener, useResizeObserver } from "@vueuse/core"
import { onScopeDispose, watch, type Ref } from "vue"

/** Follow the header's content center, regardless of rem sizing or webview zoom. */
export function useMacOSWindowControls(header: Ref<HTMLElement | null>) {
  if (!isTauri.value || platform.value !== "macos") return

  const isFullscreen = useIsFullscreen()
  let frame = 0
  let disposed = false
  let syncing = false
  let pending = false

  const sync = async () => {
    if (disposed || isFullscreen.value || !header.value) return
    if (syncing) {
      pending = true
      return
    }

    const rect = header.value.getBoundingClientRect()
    if (!rect.height || !window.innerWidth) return
    const style = getComputedStyle(header.value)
    const top = Number.parseFloat(style.paddingTop)
    const bottom = Number.parseFloat(style.paddingBottom)
    syncing = true
    try {
      const reservedWidth = await invoke<number>(
        "align_macos_window_controls",
        {
          centerY: rect.top + (rect.height + top - bottom) / 2,
          viewportWidth: window.innerWidth,
        }
      )
      if (!disposed) {
        document.documentElement.style.setProperty(
          "--macos-window-controls-width",
          `${reservedWidth}px`
        )
      }
    } catch (error) {
      console.error("Failed to align macOS window controls:", error)
    } finally {
      syncing = false
      if (pending && !disposed) {
        pending = false
        schedule()
      }
    }
  }

  const schedule = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => void sync())
  }

  useResizeObserver(header, schedule, { box: "border-box" })
  useEventListener(window, "resize", schedule)
  watch([header, isFullscreen], schedule, { flush: "post", immediate: true })
  onScopeDispose(() => {
    disposed = true
    cancelAnimationFrame(frame)
  })
}
