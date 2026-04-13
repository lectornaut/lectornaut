<script lang="ts" setup>
import { IconHistory, IconMessageCircleMore, IconPlus } from "@/data/icons"

const activeSessionId = ref("incident-review")

const todayHistory = [
  {
    id: "incident-review",
    title: "Incident review assistant",
    preview:
      "Summarize root causes from yesterday's outage and draft follow-up tasks.",
    updatedAt: "2m",
  },
  {
    id: "release-checklist",
    title: "Release checklist",
    preview: "Generate a launch checklist from the current sprint notes.",
    updatedAt: "18m",
  },
  {
    id: "meeting-brief",
    title: "Meeting brief",
    preview: "Turn product updates into a one-page stakeholder brief.",
    updatedAt: "1h",
  },
]

const previousHistory = [
  {
    id: "seo-audit",
    title: "SEO audit summary",
    preview: "Extract quick wins and estimate implementation effort.",
    updatedAt: "Yesterday",
  },
  {
    id: "support-tagging",
    title: "Support ticket tagging",
    preview: "Suggest auto-tags and escalation rules for new inbox issues.",
    updatedAt: "2d",
  },
]
</script>

<template>
  <Sidebar collapsible="none" class="w-full">
    <SidebarHeader>
      <div class="flex items-center justify-between gap-2">
        <span class="text-foreground ml-2 text-base font-medium">History</span>
        <Button variant="ghost" size="icon">
          <IconPlus />
          <span class="sr-only">New chat</span>
        </Button>
      </div>
    </SidebarHeader>
    <Separator />
    <SidebarContent>
      <OverlayScrollbarsWrapper>
        <SidebarGroup>
          <SidebarGroupLabel class="flex items-center gap-2">
            <IconHistory />
            Today
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem
                v-for="item in todayHistory"
                :key="item.id"
                class="group/history"
              >
                <SidebarMenuButton
                  :is-active="item.id === activeSessionId"
                  class="h-auto items-start gap-2 py-2"
                >
                  <IconMessageCircleMore class="mt-0.5 shrink-0" />
                  <span class="flex min-w-0 grow flex-col">
                    <span class="truncate text-sm">{{ item.title }}</span>
                    <span class="text-muted-foreground line-clamp-1 text-xs">
                      {{ item.preview }}
                    </span>
                  </span>
                  <span class="text-muted-foreground shrink-0 text-[10px]">
                    {{ item.updatedAt }}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Previous 7 days</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem
                v-for="item in previousHistory"
                :key="item.id"
                class="group/history"
              >
                <SidebarMenuButton class="h-auto items-start gap-2 py-2">
                  <IconMessageCircleMore class="mt-0.5 shrink-0" />
                  <span class="flex min-w-0 grow flex-col">
                    <span class="truncate text-sm">{{ item.title }}</span>
                    <span class="text-muted-foreground line-clamp-1 text-xs">
                      {{ item.preview }}
                    </span>
                  </span>
                  <span class="text-muted-foreground shrink-0 text-[10px]">
                    {{ item.updatedAt }}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </OverlayScrollbarsWrapper>
    </SidebarContent>
  </Sidebar>
</template>
