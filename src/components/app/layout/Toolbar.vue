<script setup lang="ts">
import { isTauri, generateId } from "@/helpers/utilities"
import emitter from "@/modules/mitt"
import { leftSidebarVisibility, rightSidebarVisibility } from "@/modules/theme"
import type { UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { useSortable } from "@vueuse/integrations/useSortable"

const el = ref<HTMLElement | null>(null)

type Tab = {
  id: number
  name: string
}

const tabs = ref<Tab[]>([
  {
    id: 1,
    name: "Sample tab",
  },
])
const selectedTab = ref(1)

useSortable(el, tabs, {
  animation: 150,
  ghostClass: "cursor-grab",
  chosenClass: "cursor-grabbing",
  dragClass: "cursor-grabbing",
})

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

emitter.on("Tabs.Add", (tab) => {
  tabs.value.push(tab as Tab)
})

emitter.on("Tabs.Close", (id) => {
  tabs.value.splice(
    tabs.value.findIndex((tab) => tab.id === id),
    1
  )
})
</script>

<template>
  <div class="sticky top-0 z-10 flex flex-col">
    <div
      data-tauri-drag-region
      class="relative flex grow items-center gap-2 p-2 transition-all"
    >
      <div class="flex items-center justify-between gap-2">
        <TooltipProvider v-if="!leftSidebarVisibility" v-motion-fade>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
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
        <TooltipProvider v-if="isTauri" v-motion-fade>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon" class="gap-2">
                <icon-lucide-arrow-left />
              </Button>
            </TooltipTrigger>
            <TooltipContent> Go back </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon" class="gap-2">
                <icon-lucide-arrow-right />
              </Button>
            </TooltipTrigger>
            <TooltipContent> Go forward </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon" class="gap-2">
                <icon-lucide-history />
              </Button>
            </TooltipTrigger>
            <TooltipContent> History </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <nav
        ref="el"
        class="relative flex w-fit min-w-0 items-center justify-start gap-2"
      >
        <Button
          v-for="tab in tabs"
          :key="tab.id"
          class="group relative flex w-56 min-w-0 grow justify-between gap-2 border border-transparent bg-transparent pr-2 font-normal shadow-none"
          :class="
            tab.id === selectedTab
              ? 'border-border before:border-border before:text-background after:border-border after:text-background min-w-24 rounded-b-none border-b-transparent before:absolute before:-bottom-2.5 before:-left-2 before:z-20 before:h-2.5 before:w-2 before:rounded-br-full before:border-r before:border-b before:shadow-[1px_1px_0_currentcolor] after:absolute after:-right-2 after:-bottom-2.5 after:z-20 after:h-2.5 after:w-2 after:rounded-bl-full after:border-b after:border-l after:shadow-[-1px_1px_0_currentcolor] hover:bg-transparent'
              : 'text-muted-foreground before:bg-muted after:bg-muted before:absolute before:-left-1.5 before:h-3 before:w-0.5 before:rounded-full after:absolute after:-right-1.5 after:h-3 after:w-0.5 after:rounded-full'
          "
          :variant="tab.id === selectedTab ? 'secondary' : 'ghost'"
          as-child
          @click="selectedTab = tab.id"
        >
          <RouterLink to="">
            <icon-lucide-inbox />
            <span class="mr-auto truncate"> {{ tab.name }} {{ tab.id }} </span>
            <TooltipProvider v-if="tabs.length > 1">
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="invisible h-4 w-4 group-hover:visible"
                    @click="emitter.emit('Tabs.Close', tab.id)"
                  >
                    <icon-lucide-x />
                  </Button>
                </TooltipTrigger>
                <TooltipContent> Close Tab </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <span
              v-if="tab.id === selectedTab"
              class="bg-background absolute -inset-x-1 -bottom-2.5 z-10 h-1"
            ></span>
          </RouterLink>
        </Button>
      </nav>
      <div
        data-tauri-drag-region
        class="flex grow items-center justify-between gap-2"
      >
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                @click="
                  emitter.emit('Tabs.Add', {
                    id: generateId(),
                    name: 'Sample tab',
                  })
                "
              >
                <icon-lucide-plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent> New Tab </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div class="flex items-center gap-2">
          <TooltipProvider>
            <!-- <TasksNotifications /> -->
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="gap-2">
                  <icon-lucide-chevron-down />
                </Button>
              </TooltipTrigger>
              <TooltipContent> Tab options </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip v-if="!rightSidebarVisibility" v-motion-fade>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
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
      </div>
    </div>
    <CommandK />
    <Settings />
    <Shortcuts />
    <ExitTrigger />
  </div>
</template>
