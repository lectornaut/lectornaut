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
              :size="iconDisplay === 'text' ? 'default' : 'icon'"
            >
              <IconAiFill />
              <template v-if="iconDisplay === 'text'"> Ask AI </template>
            </Button>
          </TooltipTrigger>
          <TooltipContent class="flex items-center gap-2 pr-2">
            Ask AI
            <Badge variant="secondary" @click="isDocked = !isDocked">
              <IconPin v-if="!isDocked" />
              <IconPinOff v-else />
              {{ isDocked ? "Unpin" : "Pin" }}
            </Badge>
            <KbdGroup>
              <Kbd>{{ getPlatformSpecialKey() }}</Kbd>
              <Kbd>↩</Kbd>
            </KbdGroup>
          </TooltipContent>
        </SheetTrigger>
        <Teleport v-if="isDocked" defer to="#right-dock" :disabled="!isDocked">
          <AiChat class="rounded-l-2xl border" />
        </Teleport>
        <SheetContent
          class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+8px)] h-auto gap-0 rounded-md border"
          :class="{ 'mt-13': isTauri && !isFullscreen }"
        >
          <SheetHeader>
            <SheetTitle> Ask AI </SheetTitle>
            <SheetDescription>
              Chat with our AI assistant to get help with your tasks.
            </SheetDescription>
          </SheetHeader>
          <Separator />
          <AiChat />
          <Separator />
          <SheetFooter>
            <InputGroup>
              <InputGroupTextarea
                v-model="userInput"
                placeholder="Ask, Search or Chat..."
              />
              <InputGroupAddon align="block-end">
                <InputGroupButton variant="outline" size="icon-xs">
                  <IconPlus />
                </InputGroupButton>
                <Select>
                  <InputGroupButton variant="ghost" as-child>
                    <SelectTrigger>
                      <SelectValue placeholder="Mode" />
                    </SelectTrigger>
                  </InputGroupButton>
                  <SelectContent side="top" align="start">
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
                <InputGroupText class="ml-auto text-xs">
                  52% used
                </InputGroupText>
                <!-- <Separator orientation="vertical" /> -->
                <InputGroupButton
                  variant="default"
                  size="icon-xs"
                  :disabled="userInput.trim().length === 0"
                >
                  <IconArrowUp />
                  <span class="sr-only">Send</span>
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </SheetFooter>
        </SheetContent>
      </Tooltip>
    </TooltipProvider>
  </Sheet>
</template>
