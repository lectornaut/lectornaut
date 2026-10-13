/**
 * The shared chat panel remembers its conversation separately from visibility.
 * Selection is local to the user/team/workspace; visibility and docking remain
 * account-synced preferences. Hiding, minimizing or handing off a conversation
 * never selects a different one. Only New chat explicitly resets the context.
 */
import { useAuthStore } from "@/stores/authStore"
import { useThemeStore } from "@/stores/themeStore"
import { createSharedComposable, useLocalStorage } from "@vueuse/core"
import { storeToRefs } from "pinia"
import { computed, ref, watch } from "vue"
import { toast } from "vue-sonner"

export type ChatPanelSelection =
  | { kind: "ask" }
  | { kind: "session"; sessionId: string; title: string; agentId?: string }
  | { kind: "agent"; agentId: string; title: string }

export const usePopout = createSharedComposable(() => {
  const themeStore = useThemeStore()
  const { currentUser, currentTeamId, currentWorkspaceId } =
    storeToRefs(useAuthStore())
  const scopeKey = computed(() => {
    const uid = currentUser.value?.uid
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    return uid && teamId && workspaceId
      ? JSON.stringify([uid, teamId, workspaceId])
      : null
  })
  const selections = useLocalStorage<Record<string, ChatPanelSelection>>(
    "chat-panel-selections",
    {},
    { listenToStorageChanges: false }
  )
  const selection = computed<ChatPanelSelection>(() =>
    scopeKey.value
      ? (selections.value[scopeKey.value] ?? { kind: "ask" })
      : { kind: "ask" }
  )
  const isChatWindowOpen = computed(
    () => !!scopeKey.value && themeStore.themeSettings.rightDockOpen
  )
  const isDocked = computed({
    get: () => themeStore.themeSettings.rightDockPinned,
    set: (value: boolean) => {
      themeStore.themeSettings.rightDockPinned = value
    },
  })
  const isPoppedOutMinimized = useLocalStorage("popout-minimized-state", false)
  const openAiAsk = computed(
    () => isChatWindowOpen.value && selection.value.kind === "ask"
  )
  const isPoppedOut = computed(
    () => isChatWindowOpen.value && selection.value.kind !== "ask"
  )
  const poppedOutSessionId = computed(() =>
    selection.value.kind === "session" ? selection.value.sessionId : null
  )
  const poppedOutAgentId = computed(() =>
    selection.value.kind === "ask" ? null : (selection.value.agentId ?? null)
  )
  const poppedOutTitle = computed(() =>
    selection.value.kind === "ask" ? "" : selection.value.title
  )

  const revision = ref(0)
  const chatContentKey = computed(() => `${scopeKey.value}:${revision.value}`)
  const chatMounted = ref(false)
  watch(
    [scopeKey, isChatWindowOpen],
    ([scope, visible], [previousScope]) => {
      if (scope !== previousScope) chatMounted.value = visible
      else if (visible) chatMounted.value = true
    },
    { immediate: true, flush: "sync" }
  )

  const setSelection = (next: ChatPanelSelection) => {
    if (!scopeKey.value) {
      toast.error("Select a team and workspace before opening a chat.")
      return false
    }
    selections.value = { ...selections.value, [scopeKey.value]: next }
    return true
  }

  const showChatWindow = () => {
    if (!scopeKey.value) {
      toast.error("Select a team and workspace before opening a chat.")
      return
    }
    isPoppedOutMinimized.value = false
    themeStore.themeSettings.rightDockOpen = true
  }

  const openChatInPopout = (sessionId: string, title: string) => {
    const changed = poppedOutSessionId.value !== sessionId
    if (!setSelection({ kind: "session", sessionId, title })) return
    if (changed) revision.value++
    showChatWindow()
  }

  const openAgentInPopout = (agentId: string, title: string) => {
    if (poppedOutAgentId.value !== agentId || selection.value.kind === "ask") {
      if (!setSelection({ kind: "agent", agentId, title })) return
      revision.value++
    }
    showChatWindow()
  }

  const startNewChat = () => {
    if (!setSelection({ kind: "ask" })) return
    revision.value++
    showChatWindow()
  }

  // Promoting a newly created chat must not remount its composer or stream.
  const rememberSession = (
    sessionId: string,
    title: string,
    agentId: string | null = poppedOutAgentId.value
  ) => {
    setSelection({
      kind: "session",
      sessionId,
      title,
      ...(agentId ? { agentId } : {}),
    })
  }

  const rememberAgent = (agentId: string | null, title: string) => {
    if (poppedOutSessionId.value) return
    setSelection(agentId ? { kind: "agent", agentId, title } : { kind: "ask" })
  }

  const closeChatWindow = () => {
    themeStore.themeSettings.rightDockOpen = false
  }

  const forgetSession = (sessionId: string) => {
    if (poppedOutSessionId.value !== sessionId) return
    closeChatWindow()
    setSelection({ kind: "ask" })
    revision.value++
  }

  const forgetAgent = (agentId: string) => {
    if (selection.value.kind !== "agent" || selection.value.agentId !== agentId)
      return
    closeChatWindow()
    setSelection({ kind: "ask" })
    revision.value++
  }

  const toggleChatWindow = () => {
    if (
      isChatWindowOpen.value &&
      (isDocked.value || !isPoppedOutMinimized.value)
    ) {
      closeChatWindow()
    } else {
      showChatWindow()
    }
  }

  return {
    selection,
    scopeKey,
    chatContentKey,
    chatMounted,
    isDocked,
    openAiAsk,
    isPoppedOut,
    isChatWindowOpen,
    isPoppedOutMinimized,
    poppedOutSessionId,
    poppedOutAgentId,
    poppedOutTitle,
    openChatInPopout,
    openAgentInPopout,
    startNewChat,
    rememberSession,
    rememberAgent,
    forgetSession,
    forgetAgent,
    closeChatWindow,
    toggleChatWindow,
  }
})
