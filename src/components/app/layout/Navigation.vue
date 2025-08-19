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

const iconDisplay = ref<"icon" | "text">("icon")
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
              <template v-if="iconDisplay === 'text'">
                {{ item.title }}
              </template>
            </RouterLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <SidebarMenuItem>
              <SidebarMenuButton>
                <icon-lucide-ellipsis />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right">
            <DropdownMenuGroup>
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
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel class="text-muted-foreground text-xs">
                Display
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup v-model="iconDisplay">
                <DropdownMenuRadioItem value="icon">
                  Icons only
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="text">
                  Icons and text
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Teleport defer to="#main-sidebar-context-menu">
          <ContextMenuContent align="end" side="bottom">
            <ContextMenuGroup>
              <ContextMenuLabel class="text-muted-foreground text-xs">
                Show
              </ContextMenuLabel>
              <ContextMenuCheckboxItem
                v-for="item in navigation"
                :key="item.id"
                v-model:model-value="visibleItems[item.id]"
              >
                {{ item.title }}
              </ContextMenuCheckboxItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuLabel class="text-muted-foreground text-xs">
                Display
              </ContextMenuLabel>
              <ContextMenuRadioGroup v-model="iconDisplay">
                <ContextMenuRadioItem value="icon">
                  Icons only
                </ContextMenuRadioItem>
                <ContextMenuRadioItem value="text">
                  Icons and text
                </ContextMenuRadioItem>
              </ContextMenuRadioGroup>
            </ContextMenuGroup>
          </ContextMenuContent>
        </Teleport>
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
</template>
