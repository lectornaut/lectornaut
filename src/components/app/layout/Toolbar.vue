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
              class="group"
              @click="emitter.emit('Sidebar.Left.Toggle')"
            >
              <icon-lucide-menu class="group-hover:hidden" />
              <icon-lucide-chevrons-right class="hidden group-hover:block" />
            </Button>
          </TooltipTrigger>
          <TooltipContent> Expand Sidebar </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <!-- <TasksNotifications /> -->
      <nav
        data-tauri-drag-region
        class="flex h-full min-w-0 grow items-center justify-start gap-2 after:absolute after:inset-x-0 after:bottom-0 after:-z-10 after:h-px after:bg-border"
      >
        <HoverCard v-for="tab in tabs" :key="tab" :close-delay="0">
          <HoverCardTrigger
            as-child
            class="group relative flex h-full min-w-0 max-w-56 grow justify-between gap-2 rounded-lg border border-b-0 border-transparent pr-1.5 font-normal"
            :class="[
              tab === selectedTab
                ? 'min-w-24 rounded-b-none border-border bg-background shadow-[0px_8px_0_0_currentcolor] shadow-background before:absolute before:-bottom-2 before:-left-2 before:z-10 before:h-2 before:w-2 before:rounded-br-full before:border-b before:border-r before:border-border before:text-background before:shadow-[2px_2px_0_currentcolor] after:absolute after:-bottom-2 after:-right-2 after:z-10 after:h-2 after:w-2 after:rounded-bl-full after:border-b after:border-l after:border-border after:text-background after:shadow-[-2px_2px_0_currentcolor] hover:bg-background'
                : 'text-muted-foreground before:absolute before:-left-1.5 before:h-3 before:w-0.5 before:rounded-full before:bg-muted after:absolute after:-right-1.5 after:h-3 after:w-0.5 after:rounded-full after:bg-muted',
              ,
              {
                'before:first:hidden':
                  tab !== selectedTab && leftSidebarVisibility,
              },
            ]"
          >
            <Button
              :variant="tab === selectedTab ? 'secondary' : 'ghost'"
              size="xs"
              as-child
              @click="selectedTab = tab"
            >
              <RouterLink to="">
                <icon-lucide-box />
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
          </HoverCardTrigger>
          <HoverCardContent>
            The Vue Framework - created and maintained by @vuejs.
          </HoverCardContent>
        </HoverCard>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="xs"
                class="rounded-lg"
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
