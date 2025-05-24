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
</script>

<template>
  <header
    class="min-h-titlebar-height ml-titlebar-left max-w-titlebar-width pt-safe-top flex shrink-0 items-center justify-center"
  >
    <div
      data-tauri-drag-region
      class="grid h-full w-full grid-cols-3 items-center gap-2 p-2"
    >
      <div
        data-tauri-drag-region
        class="flex grow items-center justify-between gap-2 transition-all"
        :class="{ 'pl-20': isTauri && !isFullscreen }"
      >
        <div class="flex gap-4">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                as-child
                class="after:bg-border relative after:absolute after:-right-2 after:h-3 after:w-px after:rounded-full"
              >
                <Button variant="ghost" size="icon">
                  <icon-lucide-grip />
                </Button>
              </TooltipTrigger>
              <TooltipContent> Menu </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TeamSwitcher />
        </div>
        <div v-if="isTauri" class="flex gap-2">
          <TooltipProvider v-motion-fade>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon">
                  <icon-lucide-arrow-left />
                </Button>
              </TooltipTrigger>
              <TooltipContent> Go back </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon">
                  <icon-lucide-arrow-right />
                </Button>
              </TooltipTrigger>
              <TooltipContent> Go forward </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      <div
        data-tauri-drag-region
        class="flex grow items-center justify-center gap-2"
      >
        <CommandK />
      </div>
      <div
        data-tauri-drag-region
        class="flex grow items-center justify-between gap-2"
      >
        <TasksNotifications />
        <div class="flex">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon">
                  <icon-lucide-panel-left />
                </Button>
              </TooltipTrigger>
              <TooltipContent> Left panel </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon">
                  <icon-lucide-panel-bottom />
                </Button>
              </TooltipTrigger>
              <TooltipContent> Bottom panel </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon">
                  <icon-lucide-panel-right />
                </Button>
              </TooltipTrigger>
              <TooltipContent> Right panel </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  </header>
</template>
