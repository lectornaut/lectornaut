<script lang="ts" setup>
import { useTeamActions } from "@/composables/useTeamActions"
import {
  IconCheck,
  IconChevronsUpDown,
  IconCirclePlus,
  IconComponent,
  IconSwitchHorizontal,
  IconUsersRound,
} from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import { emitter } from "@/modules/mitt"

const { t } = useI18n()

const {
  currentTeam,
  memberships,
  teamMembers,
  isLoading,
  switchTeam,
  getTeamMemberCount,
  canCreateTeam,
  getCannotCreateTeamReason,
} = useTeamActions()

const isCreatingTeamDialogOpen = ref(false)

const teams = computed(() =>
  memberships.value.map((m) => ({
    label: m.team.name,
    value: m.team.id,
    original: m.team,
  }))
)
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem id="tour-team-switcher">
      <ContextMenu>
        <ContextMenuTrigger>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <SidebarMenuButton
                :tooltip="t('components.teamSwitcher.switchTeam')"
                size="lg"
                class="data-[state=open]:bg-accent rounded"
              >
                <Avatar class="rounded">
                  <AvatarImage
                    class="rounded"
                    :src="currentTeam?.photoURL!"
                    :alt="currentTeam?.name"
                    referrerpolicy="no-referrer"
                  />
                  <AvatarFallback class="rounded">
                    {{ getInitials(currentTeam?.name!) }}
                  </AvatarFallback>
                </Avatar>
                <div class="flex grow flex-col">
                  <span
                    class="truncate text-base leading-tight font-semibold tracking-tight"
                  >
                    {{ currentTeam?.name }}
                  </span>
                  <span class="text-muted-foreground truncate text-xs">
                    {{ teamMembers.length === 1 ? "Free" : "Pro" }} Plan
                  </span>
                </div>
                <div class="flex items-center gap-1">
                  <div class="flex -space-x-1">
                    <Avatar
                      v-for="member in teamMembers.slice(0, 3)"
                      :key="member.userId"
                      class="ring-sidebar size-5 rounded ring-3"
                    >
                      <AvatarImage
                        class="rounded"
                        :src="member.user?.photoURL!"
                        :alt="member.user?.displayName"
                        referrerpolicy="no-referrer"
                      />
                      <AvatarFallback class="rounded">
                        {{ getInitials(member.user?.displayName!) }}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  <span
                    v-if="teamMembers.length > 3"
                    class="text-muted-foreground text-xs"
                  >
                    +{{ teamMembers.length - 3 }}
                  </span>
                </div>
                <IconChevronsUpDown />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent class="w-48" align="start" side="right">
              <DropdownMenuLabel>
                <Item size="sm" class="group w-full gap-2 rounded p-0">
                  <ItemMedia>
                    <Avatar class="rounded">
                      <AvatarImage
                        v-if="currentTeam?.photoURL"
                        class="rounded"
                        :src="currentTeam.photoURL"
                        :alt="currentTeam?.name"
                        referrerpolicy="no-referrer"
                      />
                      <AvatarFallback class="rounded">
                        {{ getInitials(currentTeam?.name!) }}
                      </AvatarFallback>
                    </Avatar>
                  </ItemMedia>
                  <ItemContent class="gap-0.5 truncate">
                    <ItemTitle class="truncate">
                      {{ currentTeam?.name }}
                    </ItemTitle>
                    <ItemDescription class="truncate text-xs">
                      {{
                        t("components.teamSwitcher.members", {
                          count: getTeamMemberCount(currentTeam?.id!),
                        })
                      }}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  @click="emitter.emit('Dialog.Settings.Open', 'members')"
                >
                  <IconUsersRound />
                  {{ t("components.teamSwitcher.menu.members") }}
                  <DropdownMenuShortcut>⇧⌘M</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem
                  @click="emitter.emit('Dialog.Settings.Open', 'teams')"
                >
                  <IconComponent />
                  {{ t("components.teamSwitcher.menu.settings") }}
                  <DropdownMenuShortcut>⌘;</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuSub>
                  <DropdownMenuItem as-child>
                    <DropdownMenuSubTrigger>
                      <IconSwitchHorizontal />
                      {{ t("components.teamSwitcher.menu.switchTeam") }}
                    </DropdownMenuSubTrigger>
                  </DropdownMenuItem>
                  <DropdownMenuSubContent class="w-56">
                    <DropdownMenuGroup
                      v-if="isLoading"
                      class="flex justify-center py-2"
                    >
                      <Spinner />
                    </DropdownMenuGroup>
                    <DropdownMenuGroup v-else>
                      <DropdownMenuLabel class="text-muted-foreground text-xs">
                        {{
                          teams.length === 0
                            ? t("components.teamSwitcher.noOtherTeams")
                            : t("components.teamSwitcher.myTeams")
                        }}
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        v-for="team in teams"
                        :key="team.value"
                        @click="switchTeam(team.value)"
                      >
                        <Item
                          size="sm"
                          class="group w-full gap-2 rounded p-0"
                        >
                          <ItemMedia>
                            <Avatar class="rounded">
                              <AvatarImage
                                class="rounded"
                                :src="team.original?.photoURL!"
                                :alt="team.label"
                                referrerpolicy="no-referrer"
                              />
                              <AvatarFallback class="rounded">
                                {{ getInitials(team.label) }}
                              </AvatarFallback>
                            </Avatar>
                          </ItemMedia>
                          <ItemContent class="gap-0.5 truncate">
                            <ItemTitle class="truncate">
                              {{ team.label }}
                            </ItemTitle>
                            <ItemDescription class="truncate text-xs">
                              {{
                                t("components.teamSwitcher.members", {
                                  count: getTeamMemberCount(team.value),
                                })
                              }}
                            </ItemDescription>
                          </ItemContent>
                          <ItemActions v-if="currentTeam?.id === team.value">
                            <IconCheck />
                          </ItemActions>
                        </Item>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <!-- Wrapper div to capture hover when disabled -->
                            <div>
                              <DropdownMenuItem
                                :disabled="!canCreateTeam"
                                @click="
                                  canCreateTeam &&
                                  (isCreatingTeamDialogOpen = true)
                                "
                              >
                                <IconCirclePlus />
                                {{ t("components.teamSwitcher.createTeam") }}
                              </DropdownMenuItem>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent v-if="!canCreateTeam">
                            {{ t(getCannotCreateTeamReason || "") }}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </DropdownMenuGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </ContextMenuTrigger>
        <ContextMenuContent class="w-48">
          <ContextMenuGroup>
            <ContextMenuItem
              @click="emitter.emit('Dialog.Settings.Open', 'members')"
            >
              <IconUsersRound />
              {{ t("components.teamSwitcher.menu.members") }}
              <ContextMenuShortcut>⇧⌘M</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              @click="emitter.emit('Dialog.Settings.Open', 'teams')"
            >
              <IconComponent />
              {{ t("components.teamSwitcher.menu.settings") }}
              <ContextMenuShortcut>⌘;</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
    </SidebarMenuItem>
  </SidebarMenu>
  <TeamDialog v-model:open="isCreatingTeamDialogOpen" mode="create" />
</template>
