<script lang="ts" setup>
import { BotChatContextKey, useBotChat } from "@/composables/useBotChat"
import { isTauri } from "@/composables/usePlatform"
import { usePopout } from "@/composables/usePopout"
import { IconSquareArrowOutUpRight } from "@/data/icons"
import { openAiAskPopoutWindow } from "@/modules/aiAskPopout"
import { useAgentConfigStore } from "@/stores/agentConfigStore"
import { useAuthStore } from "@/stores/authStore"
import { useTeamAgentsStore } from "@/stores/teamAgentsStore"
import { storeToRefs } from "pinia"
import { toast } from "vue-sonner"

const { t } = useI18n()
const {
  selection,
  poppedOutAgentId,
  poppedOutTitle,
  poppedOutSessionId,
  rememberSession,
  rememberAgent,
  forgetSession,
  forgetAgent,
  closeChatWindow,
  chatContentKey,
} = usePopout()
const initialSelection = selection.value
const mountedKey = chatContentKey.value
const botChat = useBotChat({
  autoPin: true,
  onSessionUnavailable: (id) => {
    if (chatContentKey.value === mountedKey) forgetSession(id)
  },
})
provide(BotChatContextKey, botChat)

if (initialSelection.kind !== "ask" && initialSelection.agentId) {
  botChat.selectAgent(initialSelection.agentId)
}
const failedToLoadSession = ref(false)
const loadSession = async () => {
  const id = poppedOutSessionId.value
  if (!id) return
  failedToLoadSession.value = false
  await botChat.selectSession(id)
  if (chatContentKey.value === mountedKey) {
    failedToLoadSession.value =
      poppedOutSessionId.value === id && botChat.sessionId.value !== id
  }
}
if (initialSelection.kind === "session") void loadSession()

const { pickerAgents, isLoading, loadError } = storeToRefs(useTeamAgentsStore())
const { loadedTeamId, loadError: configLoadError } = storeToRefs(
  useAgentConfigStore()
)
const { currentTeamId } = storeToRefs(useAuthStore())
watch(
  [
    pickerAgents,
    isLoading,
    loadError,
    loadedTeamId,
    configLoadError,
    selection,
  ],
  ([agents, loading, error, loadedTeam, configError, active]) => {
    if (
      chatContentKey.value !== mountedKey ||
      active.kind !== "agent" ||
      loading ||
      error ||
      configError ||
      loadedTeam !== currentTeamId.value
    )
      return
    const agent = agents.find((agent) => agent.id === active.agentId)
    if (!agent) {
      toast.error(t("ai.agentUnavailable"))
      forgetAgent(active.agentId)
    } else if (active.title !== agent.name) {
      rememberAgent(agent.id, agent.name)
    }
  },
  { immediate: true }
)

watch(
  [
    botChat.sessionId,
    botChat.activeAgentId,
    () => botChat.activeSession.value?.title,
  ],
  ([id, agentId, title]) => {
    if (chatContentKey.value !== mountedKey) return
    if (id)
      rememberSession(
        id,
        title || poppedOutTitle.value || t("pages.start.askAi"),
        agentId
      )
    else if (initialSelection.kind !== "session") {
      rememberAgent(
        agentId,
        pickerAgents.value.find((agent) => agent.id === agentId)?.name ||
          poppedOutTitle.value ||
          t("pages.start.askAi")
      )
    }
  }
)

const popOut = () => {
  openAiAskPopoutWindow({
    sessionId: botChat.sessionId.value ?? poppedOutSessionId.value,
    agentId: botChat.activeAgentId.value ?? poppedOutAgentId.value,
    title:
      botChat.activeSession.value?.title ||
      poppedOutTitle.value ||
      t("pages.start.askAi"),
  })
  closeChatWindow()
}
</script>

<template>
  <div v-if="failedToLoadSession" class="p-2">
    <Alert>
      <AlertTitle>{{ t("ai.chatLoadFailed") }}</AlertTitle>
      <AlertDescription>
        <Button variant="outline" size="sm" @click="loadSession">
          {{ t("actions.retry") }}
        </Button>
      </AlertDescription>
    </Alert>
  </div>
  <AiChatShell v-else />
  <Teleport v-if="isTauri" defer to="#popout-actions">
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger as-child>
          <InputGroupButton
            variant="ghost"
            size="icon-sm"
            :aria-label="t('ai.openInNewWindow')"
            @click="popOut"
          >
            <IconSquareArrowOutUpRight />
          </InputGroupButton>
        </TooltipTrigger>
        <TooltipContent>{{ t("ai.openInNewWindow") }}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </Teleport>
</template>
