/**
 * usePopout — shared state for the in-app floating pop-out window whose
 * chrome (drag, resize, minimize, close) lives in `MainLayout.vue`.
 *
 * Module-scope refs, so every caller gets the same instance: `AiBar`
 * opens content into the window, `MainLayout` renders the frame and the
 * `#popout-dock` teleport target it lands in. The three localStorage
 * keys are the ones MainLayout already used, so persisted position /
 * size / minimized state carries over unchanged.
 *
 * Deliberately holds ONE session at a time. Clicking a different pinned
 * chat swaps this window's content rather than spawning a second
 * floating window: a real second chat is a real OS window
 * (`openAiAskPopoutWindow`), which already exists and handles focus,
 * z-order and placement properly.
 */
import { useLocalStorage } from "@vueuse/core"

const isPoppedOut = useLocalStorage("popout-state", false)
const isPoppedOutMinimized = useLocalStorage("popout-minimized-state", false)
/** Session currently mounted in the window; null = nothing opened yet. */
const poppedOutSessionId = useLocalStorage<string | null>(
  "popout-session-id",
  null
)
/**
 * Title snapshot taken when the chat was opened. A later rename won't
 * update it — cheap, and the window is short-lived by nature.
 */
const poppedOutTitle = useLocalStorage("popout-title", "")

export function usePopout() {
  /**
   * Show `sessionId` in the pop-out. Re-opening the session already
   * mounted just restores the window (the id doesn't change, so the
   * chat is never reloaded).
   */
  const openChatInPopout = (sessionId: string, title: string) => {
    poppedOutSessionId.value = sessionId
    poppedOutTitle.value = title
    isPoppedOut.value = true
    isPoppedOutMinimized.value = false
  }

  return {
    isPoppedOut,
    isPoppedOutMinimized,
    poppedOutSessionId,
    poppedOutTitle,
    openChatInPopout,
  }
}
