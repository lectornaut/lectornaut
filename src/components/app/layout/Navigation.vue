<script lang="ts" setup>
import { IconGrid2X2Plus, IconRotateCcw } from "@/data/icons"
import { defaultMenu } from "@/helpers/defaults"
import { useLayoutStore } from "@/stores/layoutStore"
import { useSortable } from "@vueuse/integrations/useSortable"
import { storeToRefs } from "pinia"

const { t } = useI18n()
const layoutStore = useLayoutStore()
const { activeNavItems, isLoading } = storeToRefs(layoutStore)
const { toggleNavItem, resetNavItems } = layoutStore

const el = ref<HTMLElement>()

useSortable(el, activeNavItems, {
  animation: 150,
  draggable: ".nav-item",
  ghostClass: "cursor-grab",
  chosenClass: "cursor-grabbing",
  dragClass: "cursor-grabbing",
})
</script>

<template>
  <SidebarGroup data-tauri-drag-region>
    <SidebarGroupContent id="tour-primary-navigation">
      <SidebarMenu ref="el" data-tauri-drag-region>
        <template v-if="isLoading">
          <SidebarMenuItem v-for="n in 5" :key="n">
            <SidebarMenuSkeleton />
          </SidebarMenuItem>
        </template>
        <template v-else>
          <SidebarMenuItem
            v-for="item in activeNavItems"
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
            </SidebarMenuButton>
          </SidebarMenuItem>
        </template>
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
          <DropdownMenuContent side="right">
            <DropdownMenuLabel>
              {{ t("navigation.show") }}
            </DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              v-for="item in defaultMenu"
              :key="item.id"
              :model-value="activeNavItems.some((i) => i.id === item.id)"
              @update:model-value="toggleNavItem(item.id, $event)"
              @select.prevent
            >
              {{ t("navigation.menu." + item.id) }}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="resetNavItems">
              <IconRotateCcw />
              {{ t("common.reset") }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
</template>
