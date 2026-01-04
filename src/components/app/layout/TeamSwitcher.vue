<script lang="ts" setup>
import TeamDialog from "@/components/app/teams/TeamDialog.vue"
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
  <ContextMenu>
    <ContextMenuTrigger>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton
            id="tour-team-switcher"
            tooltip="Switch team"
            size="lg"
            class="data-[state=open]:bg-accent"
          >
            <Avatar class="rounded-md">
              <AvatarImage
                class="rounded-md"
                :src="currentTeam?.photoURL!"
                :alt="currentTeam?.name"
                referrerpolicy="no-referrer"
              />
              <AvatarFallback class="rounded-md">
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
                {{ getTeamMemberCount(currentTeam?.id!) }}
                {{ t("components.teamSwitcher.members") }}
              </span>
            </div>
            <div class="flex items-center gap-1">
              <div class="flex -space-x-1">
                <Avatar
                  v-for="member in teamMembers.slice(0, 3)"
                  :key="member.userId"
                  class="ring-sidebar size-5 rounded-full ring-3"
                >
                  <AvatarImage
                    class="rounded-full"
                    :src="member.user?.photoURL!"
                    :alt="member.user?.displayName"
                    referrerpolicy="no-referrer"
                  />
                  <AvatarFallback class="rounded-full">
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
            <Item size="sm" class="group w-full gap-2 p-0">
              <ItemMedia>
                <Avatar class="rounded-md">
                  <AvatarImage
                    v-if="currentTeam?.photoURL"
                    class="rounded-md"
                    :src="currentTeam.photoURL"
                    :alt="currentTeam?.name"
                    referrerpolicy="no-referrer"
                  />
                  <AvatarFallback class="rounded-md">
                    {{ getInitials(currentTeam?.name!) }}
                  </AvatarFallback>
                </Avatar>
              </ItemMedia>
              <ItemContent class="gap-0.5 truncate">
                <ItemTitle class="truncate">
                  {{ currentTeam?.name }}
                </ItemTitle>
                <ItemDescription class="truncate text-xs">
                  {{ getTeamMemberCount(currentTeam?.id!) }}
                  {{ t("components.teamSwitcher.members") }}
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
                    <Item size="sm" class="group w-full gap-2 p-0">
                      <ItemMedia>
                        <Avatar class="rounded-md">
                          <AvatarImage
                            class="rounded-md"
                            :src="team.original?.photoURL!"
                            :alt="team.label"
                            referrerpolicy="no-referrer"
                          />
                          <AvatarFallback class="rounded-md">
                            {{ getInitials(team.label) }}
                          </AvatarFallback>
                        </Avatar>
                      </ItemMedia>
                      <ItemContent class="gap-0.5 truncate">
                        <ItemTitle class="truncate">
                          {{ team.label }}
                        </ItemTitle>
                        <ItemDescription class="truncate text-xs">
                          {{ getTeamMemberCount(team.value) }}
                          {{ t("components.teamSwitcher.members") }}
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
                  <DropdownMenuItem @click="isCreatingTeamDialogOpen = true">
                    <IconCirclePlus />
                    {{ t("components.teamSwitcher.createTeam") }}
                  </DropdownMenuItem>
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
        <ContextMenuItem @click="emitter.emit('Dialog.Settings.Open', 'teams')">
          <IconComponent />
          {{ t("components.teamSwitcher.menu.settings") }}
          <ContextMenuShortcut>⌘;</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  </ContextMenu>
  <TeamDialog v-model:open="isCreatingTeamDialogOpen" mode="create" />
</template>
