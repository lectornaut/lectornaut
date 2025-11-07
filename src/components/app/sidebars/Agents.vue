<script lang="ts" setup>
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

const userInput = ref("")
</script>

<template>
  <SidebarMenu id="tour-team-members">
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger as-child>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="New Agent">
              <icon-lucide-circle-plus />
              New Agent
            </SidebarMenuButton>
          </SidebarMenuItem>
        </TooltipTrigger>
        <TooltipContent side="right"> New Agent </TooltipContent>
      </Tooltip>
      <Tooltip v-for="agent in agents" :key="agent.id">
        <Sheet>
          <SheetTrigger as-child>
            <TooltipTrigger as-child>
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
                  {{ agent.name }}
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
              <InputGroup>
                <InputGroupTextarea
                  v-model="userInput"
                  placeholder="Ask, Search or Chat..."
                />
                <InputGroupAddon align="block-end">
                  <InputGroupButton variant="outline" size="icon-xs">
                    <icon-lucide-plus />
                  </InputGroupButton>
                  <Select>
                    <InputGroupButton variant="ghost" as-child>
                      <SelectTrigger>
                        <SelectValue placeholder="Mode" />
                      </SelectTrigger>
                    </InputGroupButton>
                    <SelectContent side="top" align="start">
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="agent">Agent</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                  <InputGroupText class="ml-auto text-xs">
                    52% used
                  </InputGroupText>
                  <!-- <Separator orientation="vertical" /> -->
                  <InputGroupButton
                    variant="default"
                    size="icon-xs"
                    :disabled="userInput.trim().length === 0"
                  >
                    <icon-lucide-arrow-up />
                    <span class="sr-only">Send</span>
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </Tooltip>
    </TooltipProvider>
  </SidebarMenu>
</template>
