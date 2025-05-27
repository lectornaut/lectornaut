<script setup lang="ts">
import { useSidebar } from "@/components/ui/sidebar"
import { OverlayScrollbarsComponent } from "overlayscrollbars-vue"
import IconHome from "~icons/lucide/home"
import IconLayers2 from "~icons/lucide/layers-2"
import IconWorkflow from "~icons/lucide/workflow"

const { setOpen } = useSidebar()

const navigation = [
  {
    title: "Home",
    url: "/home",
    id: "home",
    icon: IconHome,
  },
  {
    title: "Workflows",
    url: "/workflows",
    id: "workflows",
    icon: IconWorkflow,
  },
  {
    title: "Drafts",
    url: "/drafts",
    id: "drafts",
    icon: IconLayers2,
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
