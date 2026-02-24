<script lang="ts" setup>
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import { IconAiFill, IconPin, IconPinOff } from "@/data/icons"
import { getPlatformSpecialKey } from "@/helpers/shortcuts"
import { emitter } from "@/modules/mitt"

defineProps<{
  iconDisplay?: "icon" | "text"
}>()

const isFullscreen = useIsFullscreen()

const isDocked = ref(false)

const openAiAsk = ref(false)

emitter.on("Dialog.AiAsk.Toggle", () => {
  openAiAsk.value = !openAiAsk.value
})

const { t } = useI18n()
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
              :size="iconDisplay === 'text' ? 'sm' : 'icon-sm'"
            >
              <IconAiFill />
              <template v-if="iconDisplay === 'text'">
                {{ t("pages.start.askAi") }}
              </template>
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
          <AiChatShell :placeholder="t('ai.placeholder')" />
        </Teleport>
        <SheetContent
          class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+var(--spacing)*2)] h-auto gap-0 overflow-clip rounded-lg border"
          :class="{ 'mt-12': isTauri && !isFullscreen }"
        >
          <SheetHeader>
            <SheetTitle> {{ t("pages.start.askAi") }} </SheetTitle>
            <SheetDescription>
              Chat with our AI assistant to get help with your tasks.
            </SheetDescription>
          </SheetHeader>
          <Separator />
          <AiChatShell :placeholder="t('ai.placeholder')" />
        </SheetContent>
      </Tooltip>
    </TooltipProvider>
  </Sheet>
</template>
