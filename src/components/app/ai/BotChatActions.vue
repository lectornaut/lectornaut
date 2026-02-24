<script lang="ts" setup>
import {
  IconCopy,
  IconDownload,
  IconRotateCcw,
  IconSparkles,
  IconTrash2,
  IconWrench,
} from "@/data/icons"

const controls = ref([
  {
    id: "bot-control-memory",
    label: "Memory enabled",
    description: "Use prior messages to keep answers consistent.",
    enabled: true,
  },
  {
    id: "bot-control-web",
    label: "Web access",
    description: "Allow browsing for time-sensitive answers.",
    enabled: true,
  },
  {
    id: "bot-control-citations",
    label: "Inline citations",
    description: "Attach source links for generated responses.",
    enabled: false,
  },
])
</script>

<template>
  <SidebarContent>
    <OverlayScrollbarsWrapper>
      <SidebarGroup>
        <SidebarGroupLabel>Quick actions</SidebarGroupLabel>
        <SidebarGroupContent class="grid gap-2 p-2">
          <Button variant="secondary" class="justify-start">
            <IconRotateCcw />
            Regenerate last response
          </Button>
          <Button variant="secondary" class="justify-start">
            <IconSparkles />
            Summarize conversation
          </Button>
          <Button variant="secondary" class="justify-start">
            <IconCopy />
            Copy conversation
          </Button>
          <Button variant="secondary" class="justify-start">
            <IconDownload />
            Export as markdown
          </Button>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel class="flex items-center gap-2">
          <IconWrench />
          Controls
        </SidebarGroupLabel>
        <SidebarGroupContent class="space-y-2 p-2">
          <div
            v-for="control in controls"
            :key="control.id"
            class="bg-muted/40 flex items-center justify-between gap-3 rounded-md border p-2"
          >
            <div class="min-w-0">
              <Label :for="control.id" class="text-sm">{{
                control.label
              }}</Label>
              <p class="text-muted-foreground text-xs">
                {{ control.description }}
              </p>
            </div>
            <Switch
              :id="control.id"
              v-model="control.enabled"
              class="shrink-0"
            />
          </div>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupContent class="p-2 pt-0">
          <Button variant="destructive" class="w-full justify-start">
            <IconTrash2 />
            Clear conversation
          </Button>
        </SidebarGroupContent>
      </SidebarGroup>
    </OverlayScrollbarsWrapper>
  </SidebarContent>
</template>
