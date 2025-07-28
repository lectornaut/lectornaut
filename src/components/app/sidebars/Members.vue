<script setup lang="ts">
import { isTauri } from "@/helpers/utilities"
import type { UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import Avatar from "vue-boring-avatars"

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

const agents = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
  { id: 3, name: "Charlie" },
]
</script>

<template>
  <SidebarMenu id="tour-team-members">
    <TooltipProvider>
      <Tooltip v-for="agent in agents" :key="agent.id">
        <Sheet>
          <SheetTrigger as-child>
            <TooltipTrigger
              class="group flex aspect-square items-center justify-center rounded-md transition"
              as-child
            >
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <Avatar
                    :name="`Agent ${agent.id}`"
                    :colors="[
                      'var(--chart-1)',
                      'var(--chart-2)',
                      'var(--chart-3)',
                      'var(--chart-4)',
                      'var(--chart-5)',
                    ]"
                  />
                </SidebarMenuButton>
              </SidebarMenuItem>
            </TooltipTrigger>
            <TooltipContent side="right"> {{ agent.name }} </TooltipContent>
          </SheetTrigger>
          <SheetContent
            class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+8px)] h-auto gap-0 rounded-md border"
            side="left"
            :class="{ 'mt-13': isTauri && !isFullscreen }"
          >
            <SheetHeader>
              <SheetTitle>{{ agent.name }}</SheetTitle>
              <SheetDescription>
                Chat with {{ agent.name }} to get assistance with your tasks.
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
        </Sheet>
      </Tooltip>
    </TooltipProvider>
  </SidebarMenu>
</template>
