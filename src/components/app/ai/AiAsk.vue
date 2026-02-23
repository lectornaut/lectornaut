<script lang="ts" setup>
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import {
  IconAiFill,
  IconArrowUp,
  IconPin,
  IconPinOff,
  IconPlus,
} from "@/data/icons"
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

const userInput = ref("")
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
          <AiChat />
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
          <AiChat />
          <SheetFooter
            class="bg-secondary rounded-lg rounded-b-none border p-1.5"
          >
            <InputGroup class="bg-background shadow-lg">
              <InputGroupTextarea
                v-model="userInput"
                :placeholder="t('ai.placeholder')"
              />
              <InputGroupAddon align="block-end">
                <InputGroupButton variant="outline" size="icon-xs">
                  <IconPlus />
                </InputGroupButton>
                <Select>
                  <InputGroupButton variant="ghost" as-child>
                    <SelectTrigger>
                      <SelectValue :placeholder="t('ai.mode')" />
                    </SelectTrigger>
                  </InputGroupButton>
                  <SelectContent side="top" align="start">
                    <SelectItem value="auto">{{ t("ai.auto") }}</SelectItem>
                    <SelectItem value="agent">{{ t("ai.agent") }}</SelectItem>
                    <SelectItem value="manual">{{ t("ai.manual") }}</SelectItem>
                  </SelectContent>
                </Select>
                <InputGroupText class="ml-auto text-xs">
                  52% used
                </InputGroupText>
                <Separator orientation="vertical" />
                <InputGroupButton
                  variant="default"
                  size="icon-xs"
                  :disabled="userInput.trim().length === 0"
                >
                  <IconArrowUp />
                  <span class="sr-only">{{ t("actions.send") }}</span>
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </SheetFooter>
        </SheetContent>
      </Tooltip>
    </TooltipProvider>
  </Sheet>
</template>
