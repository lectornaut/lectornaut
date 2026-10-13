<script lang="ts" setup>
import { usePopout } from "@/composables/usePopout"
import { IconAi, IconPanelRight, IconPictureInPicture2 } from "@/data/icons"
import { getPlatformSpecialKey } from "@/helpers/shortcuts"
import { emitter } from "@/modules/mitt"

const {
  selection,
  isDocked,
  chatMounted,
  chatContentKey,
  toggleChatWindow,
  startNewChat,
} = usePopout()

emitter.on("Dialog.AiAsk.Toggle", toggleChatWindow)
onUnmounted(() => {
  emitter.off("Dialog.AiAsk.Toggle", toggleChatWindow)
})

const { t } = useI18n()

const openAsk = () => {
  if (selection.value.kind === "ask") toggleChatWindow()
  else startNewChat()
}
</script>

<template>
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger as-child>
        <Button id="tour-ai-assistant" size="sm" @click="openAsk">
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
  <Teleport v-if="chatMounted" defer to="#popout-dock">
    <ChatPanelContent :key="chatContentKey" />
  </Teleport>
</template>
