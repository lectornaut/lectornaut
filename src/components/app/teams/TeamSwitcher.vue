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
import { emitter } from "@/modules/mitt"
import { isUserMembership } from "@/types/membership"

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

const isCreateTeamDialogOpen = ref(false)

// Allow other surfaces (e.g. the sidebar "Create New" menu) to open the
// create-team dialog without re-mounting it.
const openCreateTeam = () => {
  isCreateTeamDialogOpen.value = true
}
emitter.on("Dialog.CreateTeam.Open", openCreateTeam)
onUnmounted(() => emitter.off("Dialog.CreateTeam.Open", openCreateTeam))

const teams = computed(() =>
  memberships.value.map((m) => ({
    label: m.team.name,
    value: m.team.id,
    original: m.team,
  }))
)

// The avatar preview stays human-only — agents show in the members table but
// not in this strip.
const humanTeamMembers = computed(() =>
  teamMembers.value.filter(isUserMembership)
)
const hiddenTeamMemberNames = computed(() =>
  humanTeamMembers.value
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
  return `${planKey[0].toUpperCase()}${planKey.slice(1)}`
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
                <AppAvatar
                  class="size-8 rounded-md"
                  :src="currentTeam?.photoURL"
                  :name="currentTeam?.name"
                />
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
                          v-for="member in humanTeamMembers.slice(0, 3)"
                          :key="member.userId"
                        >
                          <TooltipTrigger as-child>
                            <AppAvatar
                              class="ring-sidebar size-4 ring-2"
                              :src="member.user?.photoURL"
                              :name="
                                member.user?.displayName ||
                                member.user?.email ||
                                member.userId
                              "
                            />
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
                      <Tooltip v-if="humanTeamMembers.length > 3">
                        <TooltipTrigger as-child>
                          <AppAvatar class="ring-sidebar size-4 ring-2">
                            <template #fallback>
                              +{{ humanTeamMembers.length - 3 }}
                            </template>
                          </AppAvatar>
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
                    <AppAvatar
                      class="rounded-md"
                      :src="currentTeam?.photoURL"
                      :name="currentTeam?.name"
                    />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {{ currentTeam?.name }}
                    </ItemTitle>
                    <ItemDescription class="text-xs">
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
                  <DropdownMenuSubContent>
                    <LoadingState v-if="isLoading" />
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
                            <AppAvatar
                              class="rounded-md"
                              :src="team.original?.photoURL"
                              :name="team.label"
                            />
                          </ItemMedia>
                          <ItemContent>
                            <ItemTitle>
                              {{ team.label }}
                            </ItemTitle>
                            <ItemDescription class="text-xs">
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
                                  (isCreateTeamDialogOpen = true)
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
        <ContextMenuContent>
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
  <TeamDialog v-model:open="isCreateTeamDialogOpen" mode="create" />
</template>
