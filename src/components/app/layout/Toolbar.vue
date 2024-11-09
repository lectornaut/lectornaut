<script setup lang="ts">
import { isTauri } from "@/helpers/utilities"
import emitter from "@/modules/mitt"
import { leftSidebarVisibility, rightSidebarVisibility } from "@/modules/theme"
import type { UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"

const tabs = ref(3)
const selectedTab = ref(1)

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
  <div
    class="sticky top-0 z-10 flex flex-col shadow-xl shadow-background after:absolute after:inset-x-0 after:-bottom-32 after:-z-10 after:h-32 after:bg-gradient-to-b after:from-background"
  >
    <div
      data-tauri-drag-region
      class="relative flex grow items-center justify-between gap-2 p-2 transition-all"
    >
      <TooltipProvider v-if="!leftSidebarVisibility">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              v-motion-fade
              variant="ghost"
              size="xs"
              @click="emitter.emit('Sidebar.Left.Toggle')"
            >
              <icon-lucide-chevrons-right />
            </Button>
          </TooltipTrigger>
          <TooltipContent> Expand Sidebar </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <!-- <TasksNotifications /> -->
      <nav
        data-tauri-drag-region
        class="flex h-full min-w-0 grow items-center justify-start gap-2 before:absolute before:inset-x-0 before:bottom-0 before:z-10 before:h-px before:bg-border"
      >
        <Button
          v-for="tab in tabs"
          :key="tab"
          :variant="tab === selectedTab ? 'ghost' : 'secondary'"
          size="xs"
          class="group relative flex h-full min-w-16 max-w-56 grow justify-between gap-2 rounded-b-none rounded-t-lg border border-b-0 pr-1.5 after:absolute after:-inset-x-px after:-bottom-2 after:h-2 after:border-x after:border-border after:bg-current after:transition"
          :class="
            tab === selectedTab
              ? 'bg-background after:z-20 after:text-background hover:bg-background'
              : 'text-muted-foreground after:text-muted hover:bg-secondary'
          "
          as-child
          @click="selectedTab = tab"
        >
          <RouterLink to="">
            <icon-lucide-circle />
            <span class="mr-auto truncate"> Sample tab </span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    size="xs"
                    variant="ghost"
                    class="invisible h-4 w-4 group-hover:visible"
                    @click="tabs--"
                  >
                    <icon-lucide-x />
                  </Button>
                </TooltipTrigger>
                <TooltipContent> Close Tab </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </RouterLink>
        </Button>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="secondary"
                size="xs"
                class="rounded-lg border"
                @click="tabs++"
              >
                <icon-lucide-plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent> New Tab </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </nav>
      <TooltipProvider v-if="!rightSidebarVisibility">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              v-motion-fade
              variant="ghost"
              size="xs"
              class="gap-2"
              @click="emitter.emit('Sidebar.Right.Toggle')"
            >
              <icon-mingcute-ai-fill />
            </Button>
          </TooltipTrigger>
          <TooltipContent> Chat with AI </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
    <Settings />
    <Shortcuts />
    <ExitTrigger />
  </div>
</template>
