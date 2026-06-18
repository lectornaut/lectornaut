<script lang="ts" setup>
import { useNavigation } from "@/composables/useNavigation"
import {
  IconBadgeCheck,
  IconGrid2X2Plus,
  IconGripVertical,
  IconRotateCcw,
} from "@/data/icons"

const { t } = useI18n()

// Drag-reorder targets; the wiring lives in useNavigation. `el` is the live
// sidebar list, `rosterListEl` is the edit dialog's roster list.
const el = ref<HTMLElement>()
const rosterListEl = ref<HTMLElement>()

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
  agentAvatarSeed,
  editOpen,
  rosterItems,
  isItemActive,
} = useNavigation(el, rosterListEl)
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
        <Dialog v-model:open="editOpen">
          <DialogTrigger as-child>
            <SidebarMenuItem>
              <SidebarMenuButton :tooltip="t('navigation.showMore')">
                <IconGrid2X2Plus />
                {{ t("common.edit") }}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </DialogTrigger>
          <DialogContent
            class="grid max-h-[85svh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-md"
          >
            <DialogHeader>
              <DialogTitle>{{ t("common.edit") }}</DialogTitle>
              <DialogDescription>
                {{ t("navigation.showMore") }}
              </DialogDescription>
            </DialogHeader>
            <OverlayScrollbarsWrapper>
              <!--
                Unified, draggable roster: every menu item as an Item row with a
                drag handle (reorder) + Checkbox (visibility). Reordering this
                list persists the active subset's order; see useNavigation.
              -->
              <Label class="text-muted-foreground py-4 text-xs">
                {{ t("navigation.groups.navigation") }}
              </Label>
              <ItemGroup ref="rosterListEl" class="gap-2">
                <Item
                  v-for="item in rosterItems"
                  :key="item.id"
                  variant="outline"
                  size="xs"
                  class="roster-item"
                >
                  <Button
                    class="nav-drag-handle cursor-grab touch-none active:cursor-grabbing"
                    variant="outline"
                    size="icon-xs"
                    :aria-label="t('common.reorder')"
                  >
                    <IconGripVertical />
                  </Button>
                  <ItemMedia variant="icon">
                    <Component :is="item.icon" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{{ t("navigation.menu." + item.id) }}</ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <Checkbox
                      :model-value="isItemActive(item.id)"
                      @update:model-value="
                        toggleNavItem(item.id, $event === true)
                      "
                    />
                  </ItemActions>
                </Item>
              </ItemGroup>

              <!--
                Agents section, flattened from the old submenu. The master
                toggle gates the per-agent rows (mirrors the MainSidebar `v-if`);
                per-agent rows go disabled when it's off.
              -->
              <Label class="text-muted-foreground py-4 text-xs">
                {{ t("navigation.groups.agents") }}
              </Label>
              <ItemGroup class="gap-2">
                <Item variant="outline" size="xs">
                  <ItemContent>
                    <ItemTitle>{{ t("navigation.agentsSidebar") }}</ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <Checkbox
                      :model-value="agentsSidebarVisible"
                      @update:model-value="
                        agentsSidebarVisible = $event === true
                      "
                    />
                  </ItemActions>
                </Item>
                <template v-if="pickerAgents.length">
                  <Item
                    v-for="agent in pickerAgents"
                    :key="agent.id"
                    variant="outline"
                    size="xs"
                    :data-disabled="!agentsSidebarVisible || undefined"
                    class="data-disabled:opacity-50"
                  >
                    <ItemMedia variant="image" class="rounded-full">
                      <AppAvatar
                        variant="beam"
                        :name="agentAvatarSeed(agent)"
                        class="size-4"
                      />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle class="truncate">
                        {{ agent.name }}
                      </ItemTitle>
                    </ItemContent>
                    <ItemActions>
                      <!--
                          Indicator cluster: membership check (badge-check) to
                          the LEFT of the agent-kind glyph (sparkle = custom,
                          sparkles = built-in). Mirrors the Agents sidebar.
                        -->
                      <TooltipProvider>
                        <Tooltip v-if="memberAgentIds.has(agent.id)">
                          <TooltipTrigger as-child>
                            <span><IconBadgeCheck /></span>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {{ t("ai.agents.teamMember") }}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <span
                              ><Component :is="agentKindIcon(agent.id)"
                            /></span>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {{ agentKindLabel(agent.id) }}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <Checkbox
                        :model-value="isAgentVisible(agent.id)"
                        :disabled="!agentsSidebarVisible"
                        @update:model-value="
                          setAgentVisible(agent.id, $event === true)
                        "
                      />
                    </ItemActions>
                  </Item>
                </template>
                <Empty v-else class="py-6">
                  <EmptyDescription>
                    {{ t("navigation.agentsEmpty") }}
                  </EmptyDescription>
                </Empty>
              </ItemGroup>
            </OverlayScrollbarsWrapper>
            <DialogFooter class="sm:justify-between">
              <Button variant="ghost" @click="resetNavItems">
                <IconRotateCcw />
                {{ t("common.reset") }}
              </Button>
              <DialogClose as-child>
                <Button variant="secondary">{{ t("common.close") }}</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
</template>
