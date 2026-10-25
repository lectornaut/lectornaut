import { isTauri } from "@/composables/usePlatform"
import { i18n } from "@/modules/i18n"
import { openUrl } from "@tauri-apps/plugin-opener"
import { toast } from "vue-sonner"

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
    await openUrl(url)
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

/** Rejection for a flow finished in another browser tab or popup that the
 * user closed or cancelled — a silent cancel, never an error. Same value as
 * `SUPERSEDED` in src-tauri/src/oauth.rs. */
export const BROWSER_FLOW_CANCELLED = "popup_closed"

/**
 * Waiting toast for a flow the user finishes in another browser tab. The app
 * can't always see that tab close, so Cancel runs `onCancel`, which must
 * settle `flow` (as `BROWSER_FLOW_CANCELLED`). The toast dismisses itself
 * when `flow` settles.
 */
export function showBrowserFlowToast(
  flow: Promise<unknown>,
  onCancel: () => void
): void {
  const { t } = i18n.global
  toast.promise(flow, {
    loading: t("browserAuth.waiting"),
    description: t("browserAuth.waitingDescription"),
    action: { label: t("browserAuth.cancel"), onClick: onCancel },
  })
}

/**
 * Resolve with the first same-origin `postMessage` from `popup` that
 * `accept` matches. Closing the popup or pressing Cancel on the waiting toast
 * rejects with `BROWSER_FLOW_CANCELLED`.
 */
export function waitForPopupMessage<T>(
  popup: Window,
  accept: (data: unknown) => data is T
): Promise<T> {
  let cancel = () => {}
  const flow = new Promise<T>((resolve, reject) => {
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      window.removeEventListener("message", onMessage)
      clearInterval(closeWatch)
      clearTimeout(graceTimer)
    }
    cancel = () => {
      cleanup()
      popup.close()
      reject(BROWSER_FLOW_CANCELLED)
    }
    const onMessage = (event: MessageEvent) => {
      // Origin + shape guards are the safety boundary: never read a foreign
      // origin or another flow's message.
      if (event.origin !== window.location.origin || !accept(event.data)) {
        return
      }
      cleanup()
      resolve(event.data)
    }
    // The callback posts immediately before window.close(), so a tick can see
    // `closed` with the message still in flight. Give it a grace beat to win
    // before calling it a cancel; onMessage's cleanup() clears the timer.
    const closeWatch = setInterval(() => {
      if (!popup.closed || graceTimer) return
      graceTimer = setTimeout(cancel, 400)
    }, 500)
    window.addEventListener("message", onMessage)
  })
  showBrowserFlowToast(flow, () => cancel())
  return flow
}
