<script lang="ts" setup>
import { IconGrid2X2Plus, IconRotateCcw } from "@/data/icons"
import { defaultMenu } from "@/helpers/defaults"
import { useLayoutStore } from "@/stores/layoutStore"
import { useTeamAgentsStore } from "@/stores/teamAgentsStore"
import { useSortable } from "@vueuse/integrations/useSortable"
import { storeToRefs } from "pinia"

const { t } = useI18n()
const layoutStore = useLayoutStore()
const { activeNavItems, isLoading, agentsSidebarVisible } =
  storeToRefs(layoutStore)
const { toggleNavItem, resetNavItems, isAgentVisible, setAgentVisible } =
  layoutStore

// Merged built-in + custom roster the Agents sidebar renders. Listed here
// so each agent gets its own visibility checkbox in the submenu.
const teamAgentsStore = useTeamAgentsStore()
const { pickerAgents } = storeToRefs(teamAgentsStore)

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
  <SidebarGroup>
    <SidebarGroupContent id="tour-primary-navigation">
      <SidebarMenu ref="el">
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
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {{ t("navigation.groups.navigation") }}
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
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {{ t("navigation.groups.agents") }}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <!--
                  Master toggle for the whole Agents section (mirrors the
                  MainSidebar `v-if`). Kept at the top so the per-agent
                  rows read as "within" it; they go disabled when it's off.
                -->
                <DropdownMenuCheckboxItem
                  :model-value="agentsSidebarVisible"
                  @update:model-value="agentsSidebarVisible = $event"
                  @select.prevent
                >
                  {{ t("navigation.agentsSidebar") }}
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <template v-if="pickerAgents.length">
                  <DropdownMenuCheckboxItem
                    v-for="agent in pickerAgents"
                    :key="agent.id"
                    :model-value="isAgentVisible(agent.id)"
                    :disabled="!agentsSidebarVisible"
                    @update:model-value="setAgentVisible(agent.id, $event)"
                    @select.prevent
                  >
                    {{ agent.name }}
                  </DropdownMenuCheckboxItem>
                </template>
                <DropdownMenuItem v-else disabled>
                  {{ t("navigation.agentsEmpty") }}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
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
