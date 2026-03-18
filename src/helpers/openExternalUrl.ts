import { isTauri } from "@/composables/usePlatform"
import { open } from "@tauri-apps/plugin-shell"

export function createPendingExternalTab(): Window | null {
  if (typeof window === "undefined" || isTauri.value) return null
  return window.open("", "_blank", "noopener,noreferrer")
}

export function closePendingExternalTab(
  pendingTab: Window | null | undefined
): void {
  if (pendingTab && !pendingTab.closed) {
    pendingTab.close()
  }
}

export async function openExternalUrl(
  url: string,
  pendingTab?: Window | null
): Promise<void> {
  if (isTauri.value) {
    await open(url)
    return
  }

  if (typeof window === "undefined") return

  if (pendingTab && !pendingTab.closed) {
    pendingTab.location.href = url
    pendingTab.focus()
    return
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer")
  if (!opened) {
    window.location.assign(url)
  }
}
