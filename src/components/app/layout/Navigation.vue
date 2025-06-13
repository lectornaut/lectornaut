<script setup lang="ts">
import IconActivity from "~icons/lucide/activity"
import IconBadgeCheck from "~icons/lucide/badge-check"
import IconBot from "~icons/lucide/bot"
import IconComponent from "~icons/lucide/component"
import IconHome from "~icons/lucide/home"
import IconSparkle from "~icons/lucide/sparkle"

const navigation = [
  {
    title: "Home",
    url: "/home",
    id: "home",
    icon: IconHome,
  },
  {
    title: "Agents",
    url: "/agents",
    id: "agents",
    icon: IconBot,
  },
  {
    title: "Tasks",
    url: "/tasks",
    id: "tasks",
    icon: IconBadgeCheck,
  },
  {
    title: "Runs",
    url: "/runs",
    id: "runs",
    icon: IconActivity,
  },
  {
    title: "Teams",
    url: "/teams",
    id: "teams",
    icon: IconComponent,
  },
  {
    title: "Create",
    url: "/create",
    id: "create",
    icon: IconSparkle,
  },
]
</script>

<template>
  <OverlayScrollbarsWrapper class="h-full">
    <SidebarGroup>
      <SidebarGroupContent id="tour-primary-navigation">
        <SidebarMenu>
          <SidebarMenuItem
            v-for="item in navigation"
            :key="item.title"
            class="group/nav"
          >
            <SidebarMenuButton
              class="group-has-[.router-link-active]/nav:bg-sidebar-accent group-has-[.router-link-active]/nav:text-sidebar-accent-foreground"
              :tooltip="item.title"
              as-child
            >
              <RouterLink :to="item.url">
                <component :is="item.icon" />
                {{ item.title }}
              </RouterLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  </OverlayScrollbarsWrapper>
</template>
