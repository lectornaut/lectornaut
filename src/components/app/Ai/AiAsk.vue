<script setup lang="ts">
import { isTauri } from "@/helpers/utilities"
import emitter from "@/modules/mitt"
import type { UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"

defineProps<{
  iconDisplay?: "icon" | "text"
}>()

let unlisten: UnlistenFn | undefined

const isFullscreen = computedAsync(
  async () => (isTauri.value ? await getCurrentWindow().isFullscreen() : false),
  false
)

onMounted(async () => {
  if (isTauri.value) {
    unlisten = await getCurrentWindow().onResized(async () => {
      isFullscreen.value = await getCurrentWindow().isFullscreen()
    })
  }
})

onBeforeUnmount(() => {
  if (unlisten) {
    unlisten()
  }
})

const isDocked = ref(false)

const openAiAsk = ref(false)

emitter.on("Dialog.AiAsk.Toggle", () => {
  openAiAsk.value = !openAiAsk.value
})
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
              <icon-mingcute-ai-fill />
              <RadiantText
                v-if="iconDisplay === 'text'"
                class="hidden md:flex"
                :duration="5"
                :radiant-width="20"
              >
                Ask AI
              </RadiantText>
            </Button>
          </TooltipTrigger>
          <TooltipContent class="px-2">
            <Button variant="ghost" size="sm" @click="isDocked = !isDocked">
              <icon-lucide-pin v-if="!isDocked" />
              <icon-lucide-pin-off v-else />
              {{ isDocked ? "Unpin" : "Pin" }}
            </Button>
          </TooltipContent>
        </SheetTrigger>
        <Teleport v-if="isDocked" defer to="#right-dock" :disabled="!isDocked">
          <AiChat class="shadow-border relative shadow-[-1px_0px]" />
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
            <div class="flex items-center justify-between gap-2">
              <Input placeholder="Type a message..." />
              <Button size="icon">
                <icon-lucide-send-horizontal />
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Tooltip>
    </TooltipProvider>
  </Sheet>
</template>
