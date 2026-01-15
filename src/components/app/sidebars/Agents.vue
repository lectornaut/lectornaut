<script lang="ts" setup>
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import { IconArrowUp, IconCirclePlus, IconPlus } from "@/data/icons"
import Avatar from "vue-boring-avatars"

const isFullscreen = useIsFullscreen()

const agents = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
  { id: 3, name: "Charlie" },
]

const userInput = ref("")
</script>

<template>
  <SidebarMenu id="tour-team-members">
    <SidebarMenuItem>
      <SidebarMenuButton tooltip="New Agent">
        <IconCirclePlus />
        New
      </SidebarMenuButton>
    </SidebarMenuItem>
    <Sheet v-for="agent in agents" :key="agent.id">
      <SheetTrigger as-child>
        <SidebarMenuItem>
          <SidebarMenuButton :tooltip="agent.name">
            <Avatar
              variant="beam"
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
      </SheetTrigger>
      <SheetContent
        class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+8px)] h-auto gap-0 rounded-md border"
        side="left"
        :class="{ 'mt-12': isTauri && !isFullscreen }"
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
                <IconPlus />
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
                <IconArrowUp />
                <span class="sr-only">Send</span>
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </SidebarMenu>
</template>
