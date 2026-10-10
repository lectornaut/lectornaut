<script lang="ts" setup>
import { BotChatContextKey, useBotChat } from "@/composables/useBotChat"
import { isTauri } from "@/composables/usePlatform"
import { usePopout } from "@/composables/usePopout"
import {
  IconAi,
  IconHistory,
  IconPanelRight,
  IconPictureInPicture2,
  IconSquareArrowOutUpRight,
} from "@/data/icons"
import { getPlatformSpecialKey } from "@/helpers/shortcuts"
import { openAiAskPopoutWindow } from "@/modules/aiAskPopout"
import { emitter } from "@/modules/mitt"
import { useRouter } from "vue-router"

const { isDocked, openAiAsk, isPoppedOut, toggleAiAsk } = usePopout()

emitter.on("Dialog.AiAsk.Toggle", toggleAiAsk)
onUnmounted(() => emitter.off("Dialog.AiAsk.Toggle", toggleAiAsk))

const { t } = useI18n()

// AiAsk has its own independent chat context — separate from `bot.vue`'s
// page-level one. Each opening starts a fresh session: a quick "ask" is a
// throwaway conversation, not a continuation of whatever happened last.
// Sessions still persist server-side under teams/{teamId}/workspaces/
// {workspaceId}/botSessions and remain accessible from the bot page's
// history sidebar — the reset only affects what AiAsk's UI shows.
// AiChatWindow owns the same floating/sidebar frame used by pinned chats.
// A pinned chat only hides this surface: revealing it does not count as
// a new opening, so its session and mounted composer's draft survive.
const aiAskBotChat = useBotChat({ autoPin: true })
provide(BotChatContextKey, aiAskBotChat)

watch(
  openAiAsk,
  (isOpen) => {
    if (isOpen) {
      aiAskBotChat.startNewSession()
    }
  },
  { flush: "sync" }
)

const router = useRouter()

const openHistory = () => {
  openAiAsk.value = false
  void router.push("/bot")
}

// Pop the current chat out into a detached PiP-style window. The frame
// closes; the window resumes the session (or starts fresh if nothing was
// sent yet). Repeatable — each click spawns another window. One-way:
// closing a pop-out just closes it, nothing comes back to the frame.
const popOut = () => {
  openAiAsk.value = false
  openAiAskPopoutWindow({
    sessionId: aiAskBotChat.sessionId.value,
    title: t("pages.start.askAi"),
  })
}
</script>

<template>
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger as-child>
        <Button id="tour-ai-assistant" size="sm" @click="toggleAiAsk">
          <IconAi />
          Agent
        </Button>
      </TooltipTrigger>
      <TooltipContent class="flex items-center gap-2 px-2">
        <Badge
          variant="ghost"
          class="rounded-4xl"
          @click="isDocked = !isDocked"
        >
          <IconPanelRight v-if="!isDocked" />
          <IconPictureInPicture2 v-else />
          {{ t("pages.start.askAi") }}
        </Badge>
        <KbdGroup>
          <Kbd>{{ getPlatformSpecialKey() }}</Kbd>
          <Kbd>↩</Kbd>
        </KbdGroup>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
  <Teleport v-if="openAiAsk" defer to="#popout-dock">
    <div
      v-show="!isPoppedOut"
      class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden"
    >
      <AiChatShell />
    </div>
  </Teleport>
  <Teleport v-if="openAiAsk" defer to="#popout-actions">
    <div v-show="!isPoppedOut" class="flex items-center gap-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <InputGroupButton
              variant="ghost"
              size="icon-sm"
              @click="openHistory"
            >
              <IconHistory />
            </InputGroupButton>
          </TooltipTrigger>
          <TooltipContent>{{ t("ai.botHistory") }}</TooltipContent>
        </Tooltip>
        <Tooltip v-if="isTauri">
          <TooltipTrigger as-child>
            <InputGroupButton variant="ghost" size="icon-sm" @click="popOut">
              <IconSquareArrowOutUpRight />
            </InputGroupButton>
          </TooltipTrigger>
          <TooltipContent>{{ t("ai.openInNewWindow") }}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  </Teleport>
</template>
