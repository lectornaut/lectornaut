<script lang="ts" setup>
import { useNavigation } from "@/composables/useNavigation"
import { IconBadgeCheck, IconGrid2X2Plus, IconRotateCcw } from "@/data/icons"
import { defaultMenu } from "@/helpers/defaults"

const { t } = useI18n()

// Drag-reorder target for the nav list; the wiring lives in useNavigation.
const el = ref<HTMLElement>()

// Navigation roster + drag-reorder wiring (see useNavigation). The stores stay
// the source of truth; the composable derives the agent roster metadata and
// re-exposes the nav-item state/actions the template binds.
const {
  isLoading,
  activeNavItems,
  toggleNavItem,
  resetNavItems,
  agentsSidebarVisible,
  isAgentVisible,
  setAgentVisible,
  pickerAgents,
  memberAgentIds,
  agentKindIcon,
  agentKindLabel,
} = useNavigation(el)
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
                <span class="truncate">
                  {{ t("navigation.menu." + item.id) }}
                </span>
              </RouterLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </template>
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
                    <!--
                      Indicator cluster, right-aligned via DropdownMenuShortcut.
                      The membership check (badge-check) sits to the LEFT of the
                      agent-kind glyph (sparkle = custom, sparkles = built-in).
                      Mirrors the Agents sidebar treatment.
                    -->
                    <TooltipProvider>
                      <DropdownMenuShortcut class="flex items-center gap-1">
                        <Tooltip v-if="memberAgentIds.has(agent.id)">
                          <TooltipTrigger as-child>
                            <span>
                              <IconBadgeCheck />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {{ t("ai.agents.teamMember") }}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <span>
                              <Component :is="agentKindIcon(agent.id)" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {{ agentKindLabel(agent.id) }}
                          </TooltipContent>
                        </Tooltip>
                      </DropdownMenuShortcut>
                    </TooltipProvider>
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
