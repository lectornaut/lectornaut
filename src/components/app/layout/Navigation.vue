<script setup lang="ts">
import { useSidebar } from "@/components/ui/sidebar"
import { OverlayScrollbarsComponent } from "overlayscrollbars-vue"
import IconActivity from "~icons/lucide/activity"
import IconBot from "~icons/lucide/bot"
import IconComponent from "~icons/lucide/component"
import IconHome from "~icons/lucide/home"
import IconSparkle from "~icons/lucide/sparkle"

const { setOpen } = useSidebar()

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
    title: "Teams",
    url: "/teams",
    id: "teams",
    icon: IconComponent,
  },
  {
    title: "Runs",
    url: "/runs",
    id: "runs",
    icon: IconActivity,
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
  <OverlayScrollbarsComponent
    defer
    :options="{ scrollbars: { autoHide: 'scroll' } }"
  >
    <SidebarGroup>
      <SidebarGroupContent id="tour-primary-navigation">
        <SidebarMenu>
          <SidebarMenuItem
            v-for="item in navigation"
            :key="item.title"
            class="group/nav"
          >
            <SidebarMenuButton
              class="group-has-[.router-link-active]/nav:bg-sidebar-accent group-has-[.router-link-active]/nav:text-sidebar-accent-foreground relative"
              :tooltip="item.title"
              as-child
              @click="setOpen(true)"
            >
              <RouterLink :to="item.url">
                <component :is="item.icon" />
                <span>{{ item.title }}</span>
              </RouterLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  </OverlayScrollbarsComponent>
</template>
