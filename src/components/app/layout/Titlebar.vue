<script setup lang="ts">
import { isTauri } from "@/helpers/utilities"
import type { UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import IconActivity from "~icons/lucide/activity"
import IconBadgeCheck from "~icons/lucide/badge-check"
import IconBot from "~icons/lucide/bot"
import IconComponent from "~icons/lucide/component"
import IconHome from "~icons/lucide/home"
import IconSparkle from "~icons/lucide/sparkle"

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

const menu = [
  {
    title: "Home",
    url: "/home",
    id: "home",
    icon: IconHome,
    color: "bg-teal-500/20 text-teal-500/80",
  },
  {
    title: "Agents",
    url: "/agents",
    id: "agents",
    icon: IconBot,
    color: "bg-purple-500/20 text-purple-500/80",
  },
  {
    title: "Tasks",
    url: "/tasks",
    id: "tasks",
    icon: IconBadgeCheck,
    color: "bg-sky-500/20 text-sky-500/80",
  },
  {
    title: "Runs",
    url: "/runs",
    id: "runs",
    icon: IconActivity,
    color: "bg-rose-500/20 text-rose-500/80",
  },
  {
    title: "Teams",
    url: "/teams",
    id: "teams",
    icon: IconComponent,
    color: "bg-indigo-500/20 text-indigo-500/80",
  },
  {
    title: "Create",
    url: "/create",
    id: "create",
    icon: IconSparkle,
    color: "bg-yellow-500/20 text-yellow-500/80",
  },
]
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
              <Popover>
                <PopoverTrigger as-child>
                  <TooltipTrigger as-child>
                    <Button
                      id="tour-apps-menu"
                      variant="ghost"
                      size="icon"
                      class="after:bg-border relative after:absolute after:-right-2 after:h-3 after:w-px after:rounded-full"
                    >
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
                        class="group-has-[.router-link-active]/nav:bg-accent group-has-[.router-link-active]/nav:text-accent-foreground flex aspect-square h-auto w-auto flex-col items-center justify-center gap-2 p-2"
                        as-child
                      >
                        <RouterLink :to="item.url">
                          <component
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
          <Button variant="outline" class="rounded-full">
            <icon-mingcute-ai-fill />
            Talk to AI
          </Button>
        </div>
      </div>
    </div>
  </header>
</template>
