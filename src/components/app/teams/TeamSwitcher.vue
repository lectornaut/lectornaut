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
import { isTeamBillingEntitled } from "@/helpers/billing"
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

const hiddenTeamMemberNames = computed(() =>
  teamMembers.value
    .slice(3)
    .map(
      (member) =>
        member.user?.displayName || member.user?.email || member.userId
    )
)

const currentPlanLabel = computed(() => {
  const billing = currentTeam.value?.billing
  const planKey = billing?.planKey

  if (!planKey || !isTeamBillingEntitled(billing ?? null)) {
    return "Free"
  }

  const normalizedPlan = `${planKey[0].toUpperCase()}${planKey.slice(1)}`
  // if (billing?.interval === "year") {
  //   return `${normalizedPlan} (Annual)`
  // }
  // if (billing?.interval === "month") {
  //   return `${normalizedPlan} (Monthly)`
  // }
  return `${normalizedPlan}`
})
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem id="tour-team-switcher">
      <ContextMenu>
        <ContextMenuTrigger>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <SidebarMenuButton
                class="data-[state=open]:bg-accent"
                size="lg"
                :tooltip="t('components.teamSwitcher.switchTeam')"
              >
                <!-- <Avatar>
                  <AvatarImage
                    :src="currentTeam?.photoURL!"
                    :alt="currentTeam?.name"
                    referrerpolicy="no-referrer"
                  />
                  <AvatarFallback>
                    {{ getInitials(currentTeam?.name!) }}
                  </AvatarFallback>
                </Avatar> -->
                <div class="flex grow flex-col">
                  <span
                    class="truncate text-base leading-tight font-semibold tracking-tight"
                  >
                    {{ currentTeam?.name }}
                  </span>
                  <span class="text-muted-foreground truncate text-xs">
                    {{ currentPlanLabel }}
                  </span>
                </div>
                <div class="flex items-center gap-1">
                  <TooltipProvider>
                    <div class="flex items-center gap-1">
                      <div class="flex -space-x-1">
                        <Tooltip
                          v-for="member in teamMembers.slice(0, 3)"
                          :key="member.userId"
                        >
                          <TooltipTrigger as-child>
                            <Avatar class="ring-sidebar size-4 ring-2">
                              <AvatarImage
                                :src="member.user?.photoURL!"
                                :alt="
                                  member.user?.displayName ||
                                  member.user?.email ||
                                  member.userId
                                "
                                referrerpolicy="no-referrer"
                              />
                              <AvatarFallback>
                                {{
                                  getInitials(
                                    member.user?.displayName ||
                                      member.user?.email ||
                                      member.userId
                                  )
                                }}
                              </AvatarFallback>
                            </Avatar>
                          </TooltipTrigger>
                          <TooltipContent>
                            {{
                              member.user?.displayName ||
                              member.user?.email ||
                              member.userId
                            }}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <Tooltip v-if="teamMembers.length > 3">
                        <TooltipTrigger as-child>
                          <Avatar class="ring-sidebar size-4 ring-2">
                            <AvatarFallback class="text-[10px]">
                              +{{ teamMembers.length - 3 }}
                            </AvatarFallback>
                          </Avatar>
                        </TooltipTrigger>
                        <TooltipContent class="max-w-56 text-xs">
                          {{ hiddenTeamMemberNames.join(", ") }}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </TooltipProvider>
                </div>
                <IconChevronsUpDown />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>
                <Item class="group" size="xs">
                  <ItemMedia>
                    <Avatar>
                      <AvatarImage
                        v-if="currentTeam?.photoURL"
                        :src="currentTeam.photoURL"
                        :alt="currentTeam?.name"
                        referrerpolicy="no-referrer"
                      />
                      <AvatarFallback>
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
                  <DropdownMenuSubContent class="w-50">
                    <DropdownMenuGroup
                      v-if="isLoading"
                      class="flex justify-center py-2"
                    >
                      <Spinner />
                    </DropdownMenuGroup>
                    <DropdownMenuGroup v-else>
                      <DropdownMenuLabel>
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
                        <Item class="group" size="xs">
                          <ItemMedia>
                            <Avatar>
                              <AvatarImage
                                :src="team.original?.photoURL!"
                                :alt="team.label"
                                referrerpolicy="no-referrer"
                              />
                              <AvatarFallback>
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
        <ContextMenuContent class="w-50">
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
