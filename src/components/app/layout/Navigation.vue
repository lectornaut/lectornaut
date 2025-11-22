<script lang="ts" setup>
import { IconGrid2X2Plus, IconRotateCcw } from "@/data/icons"
import { menu } from "@/helpers/defaults"
import { useLayoutStore } from "@/stores/layoutStore"
import { useSortable } from "@vueuse/integrations/useSortable"
import { storeToRefs } from "pinia"

const { t } = useI18n()
const layoutStore = useLayoutStore()
const { activeNavItems, isLoading } = storeToRefs(layoutStore)
const { toggleNavItem, resetNavItems } = layoutStore

const el = ref<HTMLElement | null>(null)

useSortable(el, activeNavItems, {
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
        <template v-if="isLoading">
          <SidebarMenuItem v-for="n in 5" :key="n">
            <Skeleton class="h-8 w-full" />
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
              <span
                v-if="iconDisplay === 'text'"
                class="text-secondary-foreground inline-block w-full text-center text-[8px] font-medium uppercase"
              >
                {{ t("navigation.menu." + item.id) }}
              </span>
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
          <DropdownMenuContent align="start" side="right">
            <DropdownMenuLabel class="text-muted-foreground text-xs">
              {{ t("navigation.show") }}
            </DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              v-for="item in menu"
              :key="item.id"
              :model-value="activeNavItems.some((i) => i.id === item.id)"
              @update:model-value="
                (checked: boolean) => toggleNavItem(item.id, checked)
              "
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
