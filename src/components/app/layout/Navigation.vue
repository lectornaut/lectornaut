<script lang="ts" setup>
import { IconGrid2X2Plus } from "@/data/icons"
import { menu } from "@/helpers/defaults"
import { useSortable } from "@vueuse/integrations/useSortable"

const { t } = useI18n()

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
            :tooltip="t('navigation.menu.' + item.id)"
            as-child
          >
            <RouterLink :to="item.url">
              <Component :is="item.icon" />
              {{ t("navigation.menu." + item.id) }}
            </RouterLink>
            <span
              v-if="iconDisplay === 'text'"
              class="text-secondary-foreground inline-block w-full text-center text-[8px] font-medium uppercase"
            >
              {{ t("navigation.menu." + item.id) }}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <Separator class="my-1" />
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <SidebarMenuItem>
              <SidebarMenuButton :tooltip="t('navigation.showMore')">
                <IconGrid2X2Plus />
                {{ t("common.edit") }}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right">
            <DropdownMenuLabel class="text-muted-foreground text-xs">
              {{ t("navigation.show") }}
            </DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              v-for="item in menu"
              :key="item.id"
              v-model:model-value="visibleItems[item.id]"
            >
              {{ t("navigation.menu." + item.id) }}
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
</template>
