<script lang="ts" setup>
import TeamDialog from "@/components/app/teams/TeamDialog.vue"
import {
  IconBxsZap,
  IconCheck,
  IconChevronDown,
  IconCirclePlus,
  IconSettings,
  IconUsers,
  IconUsersRound,
} from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import emitter from "@/modules/mitt"
import { useTeamStore } from "@/stores/teamStore"
import { storeToRefs } from "pinia"
import { computed, ref } from "vue"

const online = useOnline()
const teamStore = useTeamStore()
const { currentTeam, memberships, isLoading } = storeToRefs(teamStore)

const isCreatingTeamDialogOpen = ref(false)

// Group memberships for the dropdown
const groups = computed(() => [
  {
    label: "My Teams",
    teams: memberships.value.map((m) => ({
      label: m.team.name,
      value: m.team.id,
      original: m.team,
    })),
  },
])

const activeTeamLabel = computed(() => currentTeam.value?.name || "Select Team")
const activeTeamValue = computed(() => currentTeam.value?.id || "")

const handleSwitchTeam = (teamId: string) => {
  teamStore.switchTeam(teamId)
}
</script>

<template>
  <div class="flex items-center justify-between gap-2">
    <Dialog>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            id="tour-team-switcher"
            variant="ghost"
            class="data-[state=open]:bg-accent"
          >
            <Avatar class="size-4">
              <AvatarImage
                :src="
                  currentTeam?.photoURL ||
                  `https://avatar.vercel.sh/${activeTeamValue}.png`
                "
                :alt="activeTeamLabel"
                referrerpolicy="no-referrer"
              />
              <AvatarFallback>
                {{ getInitials(activeTeamLabel) }}
              </AvatarFallback>
            </Avatar>
            <span
              v-if="!online"
              class="bg-muted text-muted-foreground flex items-center gap-1 rounded-full border px-1.5 py-0.5"
            >
              <IconBxsZap />
              Offline
            </span>
            <span v-else class="hidden md:flex">
              {{ activeTeamLabel }}
            </span>
            <IconChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent class="w-48" align="center">
          <DropdownMenuGroup>
            <DropdownMenuItem
              @click="emitter.emit('Dialog.Settings.Open', 'teams')"
            >
              <IconSettings />
              Settings
              <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              @click="emitter.emit('Dialog.Settings.Open', 'members')"
            >
              <IconUsers />
              Members
              <DropdownMenuShortcut>⇧⌘M</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuItem as-child>
                <DropdownMenuSubTrigger>
                  <IconUsersRound />
                  Switch team
                </DropdownMenuSubTrigger>
              </DropdownMenuItem>
              <DropdownMenuSubContent class="w-48" align="start">
                <DropdownMenuGroup
                  v-if="isLoading"
                  class="flex justify-center py-2"
                >
                  <Spinner />
                </DropdownMenuGroup>
                <DropdownMenuGroup
                  v-for="group in groups"
                  v-else
                  :key="group.label"
                  :heading="group.label"
                >
                  <DropdownMenuLabel class="text-muted-foreground text-xs">
                    {{ group.label }}
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    v-for="team in group.teams"
                    :key="team.value"
                    @click="handleSwitchTeam(team.value)"
                  >
                    <Avatar class="size-4">
                      <AvatarImage
                        :src="
                          team.original.photoURL ||
                          `https://avatar.vercel.sh/${team.value}.png`
                        "
                        referrerpolicy="no-referrer"
                        :alt="team.label"
                      />
                      <AvatarFallback>
                        {{ getInitials(team.label) }}
                      </AvatarFallback>
                    </Avatar>
                    {{ team.label }}
                    <IconCheck
                      v-if="activeTeamValue === team.value"
                      class="ml-auto"
                    />
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
      <TeamDialog v-model:open="isCreatingTeamDialogOpen" mode="create" />
    </Dialog>
  </div>
</template>
