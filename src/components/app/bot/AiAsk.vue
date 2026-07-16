<script lang="ts" setup>
import { BotChatContextKey, useBotChat } from "@/composables/useBotChat"
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import { IconAiFill, IconHistory, IconPin, IconPinOff } from "@/data/icons"
import { getPlatformSpecialKey } from "@/helpers/shortcuts"
import { emitter } from "@/modules/mitt"
import { useRouter } from "vue-router"

const isFullscreen = useIsFullscreen()

const isDocked = ref(false)

const openAiAsk = ref(false)

emitter.on("Dialog.AiAsk.Toggle", () => {
  openAiAsk.value = !openAiAsk.value
})

const { t } = useI18n()

// AiAsk has its own independent chat context — separate from `bot.vue`'s
// page-level one. Each opening starts a fresh session: a quick "ask" is a
// throwaway conversation, not a continuation of whatever happened last.
// Sessions still persist server-side under teams/{teamId}/workspaces/
// {workspaceId}/botSessions and remain accessible from the bot page's
// history sidebar — the reset only affects what AiAsk's UI shows.
const aiAskBotChat = useBotChat()
provide(BotChatContextKey, aiAskBotChat)

watch(openAiAsk, (isOpen) => {
  if (isOpen) aiAskBotChat.startNewSession()
})

const router = useRouter()

const openHistory = () => {
  openAiAsk.value = false
  void router.push("/bot")
}
</script>

<template>
  <Sheet v-model:open="openAiAsk">
    <TooltipProvider>
      <Tooltip>
        <SheetTrigger as-child>
          <TooltipTrigger as-child>
            <Button
              id="tour-ai-assistant"
              variant="ghost"
              class="shadow-none"
              size="icon-sm"
            >
              <IconAiFill />
            </Button>
          </TooltipTrigger>
          <TooltipContent class="flex items-center gap-2 px-2">
            <Badge variant="secondary" @click="isDocked = !isDocked">
              <IconPin v-if="!isDocked" />
              <IconPinOff v-else />
              {{ t("pages.start.askAi") }}
            </Badge>
            <KbdGroup>
              <Kbd>{{ getPlatformSpecialKey() }}</Kbd>
              <Kbd>↩</Kbd>
            </KbdGroup>
          </TooltipContent>
        </SheetTrigger>
        <Teleport v-if="isDocked" defer to="#right-dock" :disabled="!isDocked">
          <AiChatShell />
        </Teleport>
        <SheetContent
          class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+(--spacing(2)))] h-auto! gap-0 overflow-clip rounded-md border"
          :class="{ 'mt-12': isTauri && !isFullscreen }"
          :show-close-button="false"
        >
          <SheetHeader>
            <div class="flex items-center justify-between gap-2">
              <SheetTitle>{{ t("pages.start.askAi") }}</SheetTitle>
              <Button variant="ghost" size="icon-sm" @click="openHistory">
                <IconHistory />
              </Button>
            </div>
          </SheetHeader>
          <AiChatShell />
        </SheetContent>
      </Tooltip>
    </TooltipProvider>
  </Sheet>
</template>
