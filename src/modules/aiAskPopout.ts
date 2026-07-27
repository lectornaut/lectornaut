import { platform } from "@/composables/usePlatform"
import { LogicalPosition } from "@tauri-apps/api/dpi"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"

/**
 * Spawn a detached always-on-top PiP-style window hosting a single AiAsk
 * chat (the `/ask` page). Every call creates a new window — labels are
 * unique so any number of pop-outs can coexist, and the `ask-*` glob in
 * `src-tauri/capabilities/default.json` grants each one its permissions.
 */
export const openAiAskPopoutWindow = (options: {
  sessionId: string | null
  /** Pre-select an agent persona — used when popping out an agent chat. */
  agentId?: string | null
  title: string
}): void => {
  const params = new URLSearchParams()
  if (options.sessionId) params.set("sessionId", options.sessionId)
  if (options.agentId) params.set("agentId", options.agentId)
  const search = params.toString()
  const query = search ? `?${search}` : ""

  const popout = new WebviewWindow(`ask-${crypto.randomUUID()}`, {
    url: `/ask${query}`,
    title: options.title,
    width: 400,
    height: 640,
    minWidth: 320,
    minHeight: 400,
    alwaysOnTop: true,
    center: true,
    // Match the main window's chrome on macOS — overlay traffic lights,
    // no native titlebar. Elsewhere the native frame carries the title.
    ...(platform.value === "macos"
      ? {
          titleBarStyle: "overlay" as const,
          hiddenTitle: true,
          trafficLightPosition: new LogicalPosition(16, 25),
        }
      : {}),
  })

  void popout.once("tauri://error", (event) => {
    console.error("[aiAskPopout] Couldn't create pop-out window:", event)
  })
}
