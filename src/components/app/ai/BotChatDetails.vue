<script lang="ts" setup>
import {
  IconBot,
  IconClock,
  IconDatabase,
  IconHistory,
  IconSparkles,
} from "@/data/icons"

const sessionStats = [
  { id: "messages", label: "Messages", value: "24", icon: IconHistory },
  { id: "latency", label: "Avg. response", value: "1.8s", icon: IconClock },
  {
    id: "context",
    label: "Context tokens",
    value: "18.2k / 128k",
    icon: IconDatabase,
  },
]

const contextSources = [
  { id: "workspace", name: "Workspace notes", status: "Connected" },
  { id: "codebase", name: "Current codebase", status: "Read-only" },
  { id: "tickets", name: "Support tickets", status: "Disconnected" },
]
</script>

<template>
  <SidebarContent>
    <OverlayScrollbarsWrapper>
      <SidebarGroup>
        <SidebarGroupContent class="space-y-3 p-2">
          <div class="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              <IconBot />
              Assistant
            </Badge>
            <Badge variant="secondary">
              <IconSparkles />
              Balanced mode
            </Badge>
          </div>

          <dl class="space-y-3">
            <div
              v-for="stat in sessionStats"
              :key="stat.id"
              class="flex items-start justify-between gap-2"
            >
              <dt class="text-muted-foreground flex items-center gap-2">
                <Component :is="stat.icon" />
                {{ stat.label }}
              </dt>
              <dd class="text-right font-medium">{{ stat.value }}</dd>
            </div>
          </dl>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Context sources</SidebarGroupLabel>
        <SidebarGroupContent class="space-y-2 p-2">
          <div
            v-for="source in contextSources"
            :key="source.id"
            class="bg-muted/40 flex items-center justify-between gap-2 border p-2"
          >
            <div class="min-w-0">
              <p class="truncate text-sm font-medium">{{ source.name }}</p>
            </div>
            <Badge variant="secondary" class="shrink-0 text-[10px]">
              {{ source.status }}
            </Badge>
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    </OverlayScrollbarsWrapper>
  </SidebarContent>
</template>
