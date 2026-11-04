import { isMainTauriWindow, isTauri } from "@/composables/usePlatform"
import { emitter } from "@/modules/mitt"
import { useAppPreferencesStore } from "@/stores/appPreferencesStore"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { exit } from "@tauri-apps/plugin-process"
import { useEventListener } from "@vueuse/core"
import { onScopeDispose, ref } from "vue"

/**
 * Confirm-before-closing for the accidental KEYBOARD paths only. Clicks
 * (traffic light, Window ▸ Close, app/tray Quit) never prompt: Rust only
 * forwards a menu event here when it came from its key equivalent.
 *
 *  - Desktop: ⌘W on the last tab (or with no tab / no tab router) hides the
 *    main window to the tray, ⌘Q quits. Pressing ⌘Q again while the prompt
 *    is up quits, so a wedged dialog can never trap the user.
 *  - Web: closing or reloading the browser tab with work in flight shows the
 *    browser's own "Leave site?" prompt (custom UI isn't allowed in
 *    `beforeunload`). The pref doesn't apply there.
 *
 * The `confirmClose` pref gates the idle desktop prompt. Work that a quit would lose
 * (`useCloseGuard` / `trackCloseGuard`) prompts regardless; hiding to the
 * tray loses nothing, so it never forces the desktop ⌘W prompt.
 */

export type CloseKind = "close" | "quit"

const probes = new Set<() => boolean>()
let trackedWork = 0

/** Mark work a quit would lose while the current scope is alive. */
export function useCloseGuard(isBusy: () => boolean) {
  probes.add(isBusy)
  onScopeDispose(() => probes.delete(isBusy))
}

/** Count a one-shot task (upload, download) as in flight until it settles. */
export async function trackCloseGuard<T>(work: Promise<T>): Promise<T> {
  trackedWork++
  try {
    return await work
  } finally {
    trackedWork--
  }
}

const hasWorkInFlight = () =>
  trackedWork > 0 || [...probes].some((isBusy) => isBusy())

/** The open prompt, read by `CloseConfirmDialog`. */
export const closeRequest = ref<{ kind: CloseKind; busy: boolean } | null>(null)

export const finishAppClose = (kind: CloseKind) =>
  kind === "quit" ? exit(0) : getCurrentWindow().close()

export function requestAppClose(kind: CloseKind) {
  if (kind === "quit" && closeRequest.value?.kind === "quit") {
    void finishAppClose("quit")
    return
  }
  const busy = kind === "quit" && hasWorkInFlight()
  if (!busy && !useAppPreferencesStore().confirmClose) {
    void finishAppClose(kind)
    return
  }
  closeRequest.value = { kind, busy }
}

/** Call ONCE from `App.vue`. */
export function useCloseConfirmation() {
  if (isMainTauriWindow.value) {
    // ⌘W/⌘Q key equivalents the webview didn't handle itself (e.g. focus in
    // an input, where global hotkeys are skipped). ⌘W keeps its tab meaning
    // whenever a tab router is mounted to answer it.
    const unlisten = listen<CloseKind>("close-shortcut", ({ payload }) => {
      if (payload === "close" && emitter.all.get("Tabs.Close")?.length) {
        emitter.emit("Tabs.Close")
      } else {
        requestAppClose(payload)
      }
    })
    onScopeDispose(() => void unlisten.then((stop) => stop()))
  } else if (!isTauri.value) {
    // The browser can't tell a reload from a close, so an idle prompt would
    // fire on every refresh: web only asks when something would be lost.
    useEventListener(window, "beforeunload", (event: BeforeUnloadEvent) => {
      if (hasWorkInFlight()) event.preventDefault()
    })
  }
}
