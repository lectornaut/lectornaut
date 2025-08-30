<script setup lang="ts">
import { isTauri } from "@/helpers/utilities"
import type { UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"

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
const iconDisplay = ref<"icon" | "text">("icon")
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <header
        class="min-h-titlebar-height ml-titlebar-left max-w-titlebar-width pt-safe-top shadow-border relative z-30 flex w-full shrink-0 shadow-[0px_1px]"
      >
        <div
          data-tauri-drag-region
          class="grid size-full grid-cols-3 items-center gap-2 p-2"
        >
          <div
            data-tauri-drag-region
            class="flex grow items-center justify-start gap-2 transition-all"
            :class="{ 'pl-20': isTauri && !isFullscreen }"
          >
            <Logo class="size-8 p-2" />
            <Separator orientation="vertical" class="max-h-4 min-h-4" />
            <TasksNotifications />
          </div>
          <div
            data-tauri-drag-region
            class="flex grow items-center justify-center gap-2"
          >
            <TeamSwitcher />
          </div>
          <div
            data-tauri-drag-region
            class="flex grow items-center justify-end gap-2"
          >
            <CommandK />
            <Sheet>
              <TooltipProvider>
                <Tooltip>
                  <SheetTrigger as-child>
                    <TooltipTrigger as-child>
                      <Button
                        id="tour-ai-assistant"
                        variant="ghost"
                        class="shadow-none"
                      >
                        <icon-mingcute-ai-fill />
                        <RadiantText :duration="5" :radiant-width="20">
                          Ask AI
                        </RadiantText>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent class="px-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        @click="isDocked = !isDocked"
                      >
                        <icon-lucide-pin v-if="!isDocked" />
                        <icon-lucide-pin-off v-else />
                        {{ isDocked ? "Unpin" : "Pin" }}
                      </Button>
                    </TooltipContent>
                  </SheetTrigger>
                  <Teleport
                    v-if="isDocked"
                    defer
                    to="#right-dock"
                    :disabled="!isDocked"
                  >
                    <AiChat class="shadow-border relative shadow-[-1px_0px]" />
                  </Teleport>
                  <SheetContent
                    class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+8px)] h-auto gap-0 rounded-md border"
                    :class="{ 'mt-13': isTauri && !isFullscreen }"
                  >
                    <SheetHeader>
                      <SheetTitle> Hype AI </SheetTitle>
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
          </div>
        </div>
      </header>
    </ContextMenuTrigger>
    <ContextMenuContent align="end" side="bottom">
      <ContextMenuLabel class="text-muted-foreground text-xs">
        Appearance
      </ContextMenuLabel>
      <ContextMenuRadioGroup v-model="iconDisplay">
        <ContextMenuRadioItem value="icon"> Icons only </ContextMenuRadioItem>
        <ContextMenuRadioItem value="text">
          Icons and text
        </ContextMenuRadioItem>
      </ContextMenuRadioGroup>
    </ContextMenuContent>
  </ContextMenu>
</template>
