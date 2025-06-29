<script setup lang="ts">
import { menu } from "@/helpers/defaults"
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
</script>

<template>
  <header
    class="min-h-titlebar-height ml-titlebar-left max-w-titlebar-width pt-safe-top flex shrink-0 items-center justify-center"
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
        <TooltipProvider>
          <Tooltip>
            <Popover>
              <PopoverTrigger as-child>
                <TooltipTrigger as-child>
                  <Button id="tour-apps-menu" variant="ghost" size="icon">
                    <icon-lucide-grip />
                  </Button>
                </TooltipTrigger>
                <TooltipContent> Menu </TooltipContent>
              </PopoverTrigger>
              <PopoverContent align="start" side="bottom" class="p-2">
                <div class="grid grid-cols-3 gap-2">
                  <div
                    v-for="(item, index) in menu"
                    :key="index"
                    class="group/nav"
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      class="group-has-[.router-link-active]/nav:bg-accent group-has-[.router-link-active]/nav:text-accent-foreground flex aspect-square size-auto flex-col items-center justify-center gap-2 p-2"
                      as-child
                    >
                      <RouterLink :to="item.url">
                        <Component
                          :is="item.icon"
                          class="size-8 rounded-full p-2"
                          :class="item.color"
                        />
                        {{ item.title }}
                      </RouterLink>
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </Tooltip>
        </TooltipProvider>
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
                    variant="outline"
                    class="shadow-none"
                  >
                    <icon-mingcute-ai-fill />
                    <RadiantText :duration="5" :radiant-width="20">
                      Talk to AI
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
                <AiChat class="shadow-border z-10 shadow-[-1px_0px_0px]" />
              </Teleport>
              <SheetContent class="m-3 h-auto gap-0 rounded-md border">
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
</template>
