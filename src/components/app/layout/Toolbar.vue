<script setup lang="ts">
import { isTauri } from "@/helpers/utilities"
import emitter from "@/modules/mitt"
import { leftSidebarVisibility, rightSidebarVisibility } from "@/modules/theme"
import type { UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"

const tabs = ref(13)
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
  <div class="sticky top-0 z-10 flex flex-col">
    <div
      data-tauri-drag-region
      class="flex items-center justify-between gap-2 p-2 transition-all"
      :class="{ 'ml-16': !leftSidebarVisibility && isTauri && !isFullscreen }"
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
              <icon-lucide-panel-left />
            </Button>
          </TooltipTrigger>
          <TooltipContent> Expand Sidebar </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <TasksNotifications />
      <nav
        data-tauri-drag-region
        class="no-scrollbar flex grow overflow-auto overscroll-none"
      >
        <div
          class="flex grow before:sticky before:left-0 before:z-10 before:-mx-1 before:h-full before:w-2 before:bg-gradient-to-r before:from-background after:sticky after:right-0 after:z-10 after:-mx-2 after:h-full after:w-2 after:bg-gradient-to-l after:from-background"
        >
          <div class="relative flex items-center justify-between gap-2">
            <span class="flex items-center gap-2">
              <Button
                v-for="tab in tabs"
                :key="tab"
                :variant="tab === selectedTab ? 'secondary' : 'ghost'"
                size="xs"
                class="group relative w-56 justify-between gap-2"
                :class="
                  tab === selectedTab
                    ? 'sticky left-0 right-0 z-20'
                    : 'text-secondary-foreground/50 hover:bg-secondary/50'
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
            </span>
            <!-- <span class="sticky right-0 flex items-center bg-background">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button variant="ghost" size="xs" @click="tabs++">
                      <icon-lucide-plus />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent> New Tab </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span> -->
          </div>
        </div>
      </nav>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="xs" @click="tabs++">
              <icon-lucide-plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent> New Tab </TooltipContent>
        </Tooltip>
      </TooltipProvider>
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
    <Separator />
    <Settings />
    <Shortcuts />
    <ExitTrigger />
  </div>
</template>
