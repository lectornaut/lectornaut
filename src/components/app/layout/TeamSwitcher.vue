<script lang="ts" setup>
import TeamDialog from "@/components/app/teams/TeamDialog.vue"
import { useTeamActions } from "@/composables/useTeamActions"
import {
  IconCheck,
  IconChevronsUpDown,
  IconCirclePlus,
  IconSettings,
  IconUsers,
} from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import { emitter } from "@/modules/mitt"

const { currentTeam, memberships, isLoading, switchTeam } = useTeamActions()

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
                v-if="currentTeam?.photoURL"
                :src="currentTeam.photoURL"
                class="rounded-md"
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
            <IconChevronsUpDown />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent class="w-48" align="start" side="right">
          <DropdownMenuGroup v-if="isLoading" class="flex justify-center py-2">
            <Spinner />
          </DropdownMenuGroup>
          <DropdownMenuGroup v-else>
            <DropdownMenuItem
              v-for="team in teams"
              :key="team.value"
              @click="switchTeam(team.value)"
            >
              <Item size="sm" class="group w-full gap-2 p-0">
                <ItemMedia>
                  <Avatar class="size-4 rounded-md">
                    <AvatarImage
                      v-if="team.original.photoURL"
                      class="rounded-md"
                      :src="team.original.photoURL"
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
                </ItemContent>
                <ItemActions v-if="activeTeamValue === team.value">
                  <IconCheck />
                </ItemActions>
              </Item>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              @click="emitter.emit('Dialog.Settings.Open', 'members')"
            >
              <IconUsers />
              Members
              <DropdownMenuShortcut>⇧⌘M</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              @click="emitter.emit('Dialog.Settings.Open', 'teams')"
            >
              <IconSettings />
              Settings
              <DropdownMenuShortcut>⌘;</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem @click="isCreatingTeamDialogOpen = true">
              <IconCirclePlus />
              Create team
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ContextMenuTrigger>
    <ContextMenuContent class="w-48">
      <ContextMenuGroup>
        <ContextMenuItem
          @click="emitter.emit('Dialog.Settings.Open', 'members')"
        >
          <IconUsers />
          Members
          <ContextMenuShortcut>⇧⌘M</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem @click="emitter.emit('Dialog.Settings.Open', 'teams')">
          <IconSettings />
          Settings
          <ContextMenuShortcut>⌘;</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  </ContextMenu>
  <TeamDialog v-model:open="isCreatingTeamDialogOpen" mode="create" />
</template>
