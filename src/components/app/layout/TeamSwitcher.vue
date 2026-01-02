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

const activeTeamLabel = computed(() => currentTeam.value?.name || "Select Team")
const activeTeamValue = computed(() => currentTeam.value?.id || "")
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
                :alt="activeTeamLabel"
                referrerpolicy="no-referrer"
              />
              <AvatarFallback class="rounded-md">
                {{ getInitials(activeTeamLabel) }}
              </AvatarFallback>
            </Avatar>
            <span
              class="flex grow truncate text-base leading-tight font-semibold tracking-tight"
            >
              {{ activeTeamLabel }}
            </span>
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
                    :alt="activeTeamLabel"
                    referrerpolicy="no-referrer"
                  />
                  <AvatarFallback class="rounded-md">
                    {{ getInitials(activeTeamLabel) }}
                  </AvatarFallback>
                </Avatar>
              </ItemMedia>
              <ItemContent class="gap-0.5 truncate">
                <ItemTitle class="truncate">
                  {{ currentTeam?.name }}
                </ItemTitle>
                <ItemDescription class="truncate text-xs">
                  {{ getTeamMemberCount(currentTeam?.id!) }} members
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
              Members
              <DropdownMenuShortcut>⇧⌘M</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              @click="emitter.emit('Dialog.Settings.Open', 'teams')"
            >
              <IconComponent />
              Settings
              <DropdownMenuShortcut>⌘;</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuItem as-child>
                <DropdownMenuSubTrigger>
                  <IconSwitchHorizontal />
                  Switch team
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
                    My Teams
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
                          {{ getTeamMemberCount(team.value) }} members
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions v-if="activeTeamValue === team.value">
                        <IconCheck />
                      </ItemActions>
                    </Item>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem @click="isCreatingTeamDialogOpen = true">
                    <IconCirclePlus />
                    Create team
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
          Members
          <ContextMenuShortcut>⇧⌘M</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem @click="emitter.emit('Dialog.Settings.Open', 'teams')">
          <IconComponent />
          Settings
          <ContextMenuShortcut>⌘;</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  </ContextMenu>
  <TeamDialog v-model:open="isCreatingTeamDialogOpen" mode="create" />
</template>
