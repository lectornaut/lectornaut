<script lang="ts" setup>
import { isBuiltInAgentId } from "@/data/builtInAgents"
import {
  IconBadgeCheck,
  IconGrid2X2Plus,
  IconRotateCcw,
  IconSparkle,
  IconSparkles,
} from "@/data/icons"
import { defaultMenu } from "@/helpers/defaults"
import { useLayoutStore } from "@/stores/layoutStore"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamAgentsStore } from "@/stores/teamAgentsStore"
import { isAgentMembership } from "@/types/membership"
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

// Agents added as members of the active team get a corner dot in the
// submenu below. `teamMembers` is already scoped to the current team, so
// we just narrow to the agent rows and key by agentId for an O(1) lookup.
const membershipStore = useMembershipStore()
const { teamMembers } = storeToRefs(membershipStore)
const memberAgentIds = computed(
  () =>
    new Set(
      teamMembers.value
        .filter(isAgentMembership)
        .map((member) => member.agentId)
    )
)

// Agent-kind glyph + label. A single `sparkle` marks an admin-authored
// custom agent; the plural `sparkles` marks a built-in preset. Keyed off
// `isBuiltInAgentId`, which detects the `_`-prefixed built-in ids.
const agentKindIcon = (agentId: string) =>
  isBuiltInAgentId(agentId) ? IconSparkles : IconSparkle
const agentKindLabel = (agentId: string) =>
  isBuiltInAgentId(agentId)
    ? t("ai.agents.builtInTooltip")
    : t("ai.agents.customTooltip")

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
