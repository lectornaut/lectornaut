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
/** Rejection when the browser blocks the popup. */
export const BROWSER_FLOW_BLOCKED = "popup_blocked"

/**
 * Waiting toast for a flow the user finishes in another browser tab. Open
 * runs `onOpen` to bring that tab back (the toast stays up); Cancel runs
 * `onCancel`, which must settle `flow` as `BROWSER_FLOW_CANCELLED`. The
 * toast dismisses itself when `flow` settles.
 */
export function showBrowserFlowToast(
  flow: Promise<unknown>,
  { onOpen, onCancel }: { onOpen: () => void; onCancel: () => void }
): void {
  const { t } = i18n.global
  toast.promise(flow, {
    loading: t("browserAuth.waiting"),
    action: {
      label: t("browserAuth.open"),
      onClick: (event) => {
        // Keeps the toast up: the flow is still waiting.
        event.preventDefault()
        onOpen()
      },
    },
    cancel: { label: t("browserAuth.cancel"), onClick: onCancel },
  })
}

/**
 * Open a named popup and resolve with the first same-origin `postMessage`
 * from it that `accept` matches. Rejects with `BROWSER_FLOW_BLOCKED` if the
 * browser blocks it (call inside the click), or `BROWSER_FLOW_CANCELLED` when
 * the popup closes or the toast's Cancel is pressed. The toast's Open reruns
 * `window.open` with the same name: the browser refocuses that popup (or, if
 * it lost track of it, opens the URL fresh).
 */
export function waitForPopupMessage<T>(
  url: string,
  accept: (data: unknown) => data is T,
  features?: string
): Promise<T> {
  const open = () => window.open(url, "lectornaut-browser-flow", features)
  let popup = open()
  if (!popup) return Promise.reject(BROWSER_FLOW_BLOCKED)

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
      popup?.close()
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
      if (!popup?.closed || graceTimer) return
      graceTimer = setTimeout(cancel, 400)
    }, 500)
    window.addEventListener("message", onMessage)
  })
  showBrowserFlowToast(flow, {
    onOpen: () => {
      popup = open() ?? popup
      popup?.focus()
    },
    onCancel: () => cancel(),
  })
  return flow
}
