<script lang="ts" setup>
import { menu } from "@/helpers/defaults"
import { useSortable } from "@vueuse/integrations/useSortable"

const visibleItems = ref<Record<string, boolean>>(
  menu.reduce(
    (acc, item) => {
      acc[item.id] = true
      return acc
    },
    {} as Record<string, boolean>
  )
)

const filteredNavigation = computed(() => {
  return menu.filter((item) => visibleItems.value[item.id])
})

const el = ref<HTMLElement | null>(null)

useSortable(el, filteredNavigation, {
  animation: 150,
  draggable: ".nav-item",
  ghostClass: "cursor-grab",
  chosenClass: "cursor-grabbing",
  dragClass: "cursor-grabbing",
})

defineProps<{
  iconDisplay?: "icon" | "text"
}>()
</script>

<template>
  <SidebarGroup>
    <SidebarGroupContent id="tour-primary-navigation">
      <SidebarMenu ref="el">
        <SidebarMenuItem
          v-for="item in filteredNavigation"
          :key="item.id"
          class="group/nav nav-item"
        >
          <SidebarMenuButton
            class="group-has-[.router-link-active]/nav:bg-sidebar-accent group-has-[.router-link-active]/nav:text-sidebar-accent-foreground"
            :tooltip="item.title"
            as-child
          >
            <RouterLink :to="item.url">
              <Component :is="item.icon" />
              {{ item.title }}
            </RouterLink>
            <span
              v-if="iconDisplay === 'text'"
              class="text-secondary-foreground inline-block w-full text-center text-[8px] font-medium uppercase"
            >
              {{ item.title }}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <Separator class="my-1" />
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Show more options">
                <icon-lucide-grid-2-x-2-plus />
                Edit
              </SidebarMenuButton>
            </SidebarMenuItem>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right">
            <DropdownMenuLabel class="text-muted-foreground text-xs">
              Show
            </DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              v-for="item in menu"
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
