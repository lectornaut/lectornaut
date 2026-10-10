/**
 * usePopout — shared state for the in-app floating window whose
 * chrome (drag, resize, minimize, close) lives in `AiChatWindow.vue`.
 *
 * Module-scope refs, so every caller gets the same instance: `AiBar`
 * opens content into the window, `AiChatWindow` renders the frame and the
 * `#popout-dock` teleport target it lands in. The three localStorage
 * keys are the ones MainLayout already used, so persisted position /
 * size / minimized state carries over unchanged.
 *
 * Deliberately holds ONE session at a time. Clicking a different pinned
 * chat swaps this window's content rather than spawning a second
 * floating window: a real second chat is a real OS window
 * (`openAiAskPopoutWindow`), which already exists and handles focus,
 * z-order and placement properly.
 *
 * `isDocked` is shared with Ask AI: the same mounted chat frame aligns
 * with `#right-dock` without resetting its session or floating geometry.
 * Its mode is backed by the account-synced appearance preference.
 * Pinned chats cover Ask AI without unmounting it. Closing the frame
 * dismisses both surfaces; a native handoff can reveal Ask AI instead.
 */
import { useThemeStore } from "@/stores/themeStore"
import { useLocalStorage } from "@vueuse/core"
import { computed, ref, watch } from "vue"

// Shared by Ask AI and pinned chats; only one is visible at a time.
const openAiAsk = ref(false)
const isPoppedOut = useLocalStorage("popout-state", false)
const isChatWindowOpen = computed(() => isPoppedOut.value || openAiAsk.value)
watch(
  openAiAsk,
  (open) => {
    if (open) isPoppedOut.value = false
  },
  { flush: "sync" }
)
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
  const themeStore = useThemeStore()
  const isDocked = computed({
    get: () => themeStore.themeSettings.chatWindowMode === "sidebar",
    set: (value: boolean) => {
      themeStore.themeSettings.chatWindowMode = value ? "sidebar" : "floating"
    },
  })

  /**
   * Show `sessionId` in the floating window. Re-opening the session already
   * mounted just restores the window (the id doesn't change, so the
   * chat is never reloaded).
   */
  const openChatInPopout = (sessionId: string, title: string) => {
    poppedOutSessionId.value = sessionId
    poppedOutTitle.value = title
    isPoppedOut.value = true
    isPoppedOutMinimized.value = false
  }

  const toggleAiAsk = () => {
    if (isPoppedOut.value) {
      isPoppedOut.value = false
      openAiAsk.value = true
    } else {
      openAiAsk.value = !openAiAsk.value
    }
  }

  const closeChatWindow = () => {
    openAiAsk.value = false
    isPoppedOut.value = false
  }

  const toggleChatWindow = () => {
    if (isChatWindowOpen.value) {
      closeChatWindow()
    } else if (poppedOutSessionId.value) {
      openChatInPopout(poppedOutSessionId.value, poppedOutTitle.value)
    } else {
      openAiAsk.value = true
    }
  }

  return {
    isDocked,
    openAiAsk,
    isPoppedOut,
    isChatWindowOpen,
    isPoppedOutMinimized,
    poppedOutSessionId,
    poppedOutTitle,
    openChatInPopout,
    toggleAiAsk,
    closeChatWindow,
    toggleChatWindow,
  }
}
