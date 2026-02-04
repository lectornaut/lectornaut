<script lang="ts" setup>
import { columns } from "@/components/table/columns"
import { IconCheck, IconChevronRight, IconPlus } from "@/data/icons"
import _tasks from "@/data/tasks.json"
import { getLocalTimeZone, today } from "@internationalized/date"

const tasks = _tasks

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

const { t } = useI18n()

const calendars = computed(() => [
  {
    name: t("pages.tasks.calendars.myCalendars"),
    items: [
      t("pages.tasks.items.personal"),
      t("pages.tasks.items.work"),
      t("pages.tasks.items.family"),
    ],
  },
  {
    name: t("pages.tasks.calendars.favorites"),
    items: [t("pages.tasks.items.holidays"), t("pages.tasks.items.birthdays")],
  },
  {
    name: t("pages.tasks.calendars.other"),
    items: [
      t("pages.tasks.items.travel"),
      t("pages.tasks.items.reminders"),
      t("pages.tasks.items.deadlines"),
    ],
  },
])
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
              class="**:[[role=gridcell]]:w-full"
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
                    <IconChevronRight
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
                            <IconCheck
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
              <IconPlus />
              <span>{{ t("pages.tasks.newCalendar") }}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  </Teleport>
  <DataTable :data="tasks" :columns="columns" />
  <Teleport defer to="#right-sidebar">
    <Sidebar collapsible="none" class="w-full"></Sidebar>
  </Teleport>
</template>
