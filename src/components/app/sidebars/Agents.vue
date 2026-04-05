<script lang="ts" setup>
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import { IconCirclePlus } from "@/data/icons"
import Avatar from "vue-boring-avatars"

const isFullscreen = useIsFullscreen()

const agents = [
  { id: 1, name: "Alpha" },
  { id: 2, name: "Beta" },
  { id: 3, name: "Gamma" },
]
</script>

<template>
  <SidebarMenu id="tour-team-members" data-tauri-drag-region>
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
              :name="agent.name"
              :colors="[
                'var(--color-chart-1)',
                'var(--color-chart-2)',
                'var(--color-chart-3)',
                'var(--color-chart-4)',
                'var(--color-chart-5)',
              ]"
            />
            {{ agent.name }}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SheetTrigger>
      <SheetContent
        class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+var(--spacing)*2)] h-auto gap-0 overflow-clip rounded-3xl border"
        side="left"
        :class="{ 'mt-12': isTauri && !isFullscreen }"
      >
        <SheetHeader>
          <SheetTitle>{{ agent.name }}</SheetTitle>
        </SheetHeader>
        <AiChatShell />
      </SheetContent>
    </Sheet>
  </SidebarMenu>
</template>
