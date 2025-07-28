<script setup lang="ts">
import { columns } from "@/components/table/columns"
import tasks from "@/data/tasks.json"
import { getLocalTimeZone, today } from "@internationalized/date"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Tasks",
    breadcrumb: "Tasks",
  },
})

useHead({
  title: "Tasks",
})

const calendars = [
  {
    name: "My Calendars",
    items: ["Personal", "Work", "Family"],
  },
  {
    name: "Favorites",
    items: ["Holidays", "Birthdays"],
  },
  {
    name: "Other",
    items: ["Travel", "Reminders", "Deadlines"],
  },
]
</script>

<template>
  <Teleport defer to="#left-sidebar">
    <Sidebar collapsible="none" class="w-full">
      <SidebarHeader>
        <SidebarGroup>
          <SidebarGroupContent>
            <RangeCalendar
              :max-value="today(getLocalTimeZone())"
              initial-focus
              class="[&_[role=gridcell]]:w-full"
            />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarHeader>
      <Separator />
      <SidebarContent>
        <OverlayScrollbarsWrapper>
          <template v-for="(calendar, index) in calendars" :key="calendar.name">
            <SidebarGroup>
              <Collapsible
                :default-open="index === 0"
                class="group/collapsible"
              >
                <SidebarGroupLabel
                  as-child
                  class="group/label text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground w-full text-sm"
                >
                  <CollapsibleTrigger>
                    {{ calendar.name }}
                    <icon-lucide-chevron-right
                      class="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90"
                    />
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      <SidebarMenuItem
                        v-for="(item, itemIndex) in calendar.items"
                        :key="item"
                      >
                        <SidebarMenuButton>
                          <div
                            :data-active="itemIndex < 2"
                            class="group/calendar-item border-sidebar-border text-sidebar-primary-foreground data-[active=true]:border-sidebar-primary data-[active=true]:bg-sidebar-primary flex aspect-square size-4 shrink-0 items-center justify-center rounded-sm border"
                          >
                            <icon-lucide-check
                              class="hidden size-3 group-data-[active=true]/calendar-item:block"
                            />
                          </div>
                          {{ item }}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </Collapsible>
            </SidebarGroup>
          </template>
        </OverlayScrollbarsWrapper>
      </SidebarContent>
      <Separator />
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton>
              <icon-lucide-plus />
              <span>New Calendar</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  </Teleport>
  <div class="flex grow flex-col overflow-auto overscroll-none">
    <DataTable :data="tasks" :columns="columns" />
  </div>
  <Teleport defer to="#right-sidebar">
    <Sidebar collapsible="none" class="w-full"> </Sidebar>
  </Teleport>
</template>
