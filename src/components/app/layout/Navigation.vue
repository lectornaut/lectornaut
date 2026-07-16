<script lang="ts" setup>
import { useNavigation } from "@/composables/useNavigation"
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import {
  IconBadgeCheck,
  IconGrid2X2Plus,
  IconGripHorizontal,
  IconRotateCcw,
} from "@/data/icons"

const { t } = useI18n()
const isFullscreen = useIsFullscreen()

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
        <Sheet v-model:open="editOpen">
          <SheetTrigger as-child>
            <SidebarMenuItem>
              <SidebarMenuButton :tooltip="t('navigation.showMore')">
                <IconGrid2X2Plus />
                {{ t("common.edit") }}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SheetTrigger>
          <SheetContent
            class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+(--spacing(2)))] h-auto! gap-0 overflow-clip rounded-md border"
            side="left"
            :class="{ 'mt-12': isTauri && !isFullscreen }"
          >
            <SheetHeader>
              <SheetTitle>{{ t("common.edit") }}</SheetTitle>
              <SheetDescription>
                {{ t("navigation.showMore") }}
              </SheetDescription>
            </SheetHeader>
            <OverlayScrollbarsWrapper>
              <div class="flex grow flex-col gap-4 px-6">
                <!--
                Unified, draggable roster: every menu item as an Item row with a
                drag handle (reorder) + Switch (visibility). Reordering this
                list persists the active subset's order; see useNavigation.
              -->
                <Label class="text-muted-foreground text-xs">
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
                      variant="ghost"
                      size="icon-xs"
                      :aria-label="t('common.reorder')"
                    >
                      <IconGripHorizontal />
                    </Button>
                    <ItemMedia variant="icon">
                      <Component :is="item.icon" />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{{
                        t("navigation.menu." + item.id)
                      }}</ItemTitle>
                    </ItemContent>
                    <ItemActions>
                      <Switch
                        :model-value="isItemActive(item.id)"
                        @update:model-value="toggleNavItem(item.id, $event)"
                      />
                    </ItemActions>
                  </Item>
                </ItemGroup>

                <!--
                Agents section, flattened from the old submenu. The master
                toggle gates the per-agent rows (mirrors the MainSidebar `v-if`);
                per-agent rows go disabled when it's off.
              -->
                <Label class="text-muted-foreground text-xs">
                  {{ t("navigation.groups.agents") }}
                </Label>
                <ItemGroup class="gap-2">
                  <Item variant="outline" size="xs">
                    <ItemContent>
                      <ItemTitle>{{ t("navigation.agentsSidebar") }}</ItemTitle>
                    </ItemContent>
                    <ItemActions>
                      <Switch v-model="agentsSidebarVisible" />
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
                      <ItemMedia variant="image" class="rounded-md">
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
                        <Switch
                          :model-value="isAgentVisible(agent.id)"
                          :disabled="!agentsSidebarVisible"
                          @update:model-value="
                            setAgentVisible(agent.id, $event)
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
              </div>
            </OverlayScrollbarsWrapper>
            <SheetFooter>
              <Button
                variant="secondary"
                class="justify-start"
                @click="resetNavItems"
              >
                <IconRotateCcw />
                {{ t("common.reset") }}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
</template>
