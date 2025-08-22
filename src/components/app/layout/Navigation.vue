<script setup lang="ts">
import { computed, ref } from "vue"
import IconActivity from "~icons/lucide/activity"
import IconBadgeCheck from "~icons/lucide/badge-check"
import IconBot from "~icons/lucide/bot"
import IconComponent from "~icons/lucide/component"
import IconHome from "~icons/lucide/home"
import IconPen from "~icons/lucide/pen"
import IconSparkle from "~icons/lucide/sparkle"
import IconExplore from "~icons/lucide/telescope"

const navigation = [
  {
    title: "Home",
    url: "/home",
    id: "home",
    icon: IconHome,
  },
  {
    title: "Write",
    url: "/write",
    id: "write",
    icon: IconPen,
  },
  {
    title: "Explore",
    url: "/explore",
    id: "explore",
    icon: IconExplore,
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

const visibleItems = ref<Record<string, boolean>>(
  navigation.reduce(
    (acc, item) => {
      acc[item.id] = true
      return acc
    },
    {} as Record<string, boolean>
  )
)

const filteredNavigation = computed(() => {
  return navigation.filter((item) => visibleItems.value[item.id])
})

defineProps<{
  iconDisplay?: "icon" | "text"
}>()
</script>

<template>
  <SidebarGroup>
    <SidebarGroupContent id="tour-primary-navigation">
      <SidebarMenu>
        <SidebarMenuItem
          v-for="item in filteredNavigation"
          :key="item.title"
          class="group/nav"
        >
          <SidebarMenuButton
            class="group-has-[.router-link-active]/nav:bg-sidebar-accent group-has-[.router-link-active]/nav:text-sidebar-accent-foreground"
            :tooltip="item.title"
            as-child
          >
            <RouterLink :to="item.url" class="flex flex-col">
              <Component :is="item.icon" />
            </RouterLink>
            <span
              v-if="iconDisplay === 'text'"
              class="text-secondary-foreground inline-block w-full text-center text-[8px] font-medium uppercase"
            >
              {{ item.title }}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Show more options">
                <icon-lucide-more-horizontal />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right">
            <DropdownMenuLabel class="text-muted-foreground text-xs">
              Show
            </DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              v-for="item in navigation"
              :key="item.id"
              v-model:model-value="visibleItems[item.id]"
            >
              {{ item.title }}
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
</template>
