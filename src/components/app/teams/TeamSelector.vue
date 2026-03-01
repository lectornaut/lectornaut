<script lang="ts" setup>
import { useTeamActions } from "@/composables/useTeamActions"
import { IconCirclePlus, IconLogOut, IconUsers } from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import { emitter } from "@/modules/mitt"
import { useTeamStore } from "@/stores/teamStore"
import { storeToRefs } from "pinia"
import type { AcceptableValue } from "reka-ui"
import { toast } from "vue-sonner"

const teamStore = useTeamStore()
const { memberships, isLoading } = storeToRefs(teamStore)

const isCreatingTeamDialogOpen = ref(false)

const computedTeams = computed(() =>
  memberships.value.map((m) => ({
    label: m.team.name,
    value: m.team.id,
    original: m.team,
  }))
)

const { currentTeam, canCreateTeam, getCannotCreateTeamReason } =
  useTeamActions()

const switchTeam = async (teamId: AcceptableValue) => {
  if (typeof teamId !== "string") return

  try {
    await teamStore.switchTeam(teamId)
  } catch (_error) {
    toast.error("Failed to switch team")
  }
}
</script>

<template>
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <IconUsers class="text-muted-foreground size-6" />
      </EmptyMedia>
      <EmptyTitle>Teams</EmptyTitle>
      <EmptyDescription> Select a team to continue </EmptyDescription>
    </EmptyHeader>
    <EmptyContent
      class="bg-background flex max-w-xs flex-col items-stretch gap-2 rounded-lg border p-2"
    >
      <div v-if="isLoading" class="flex justify-center p-4">
        <Spinner />
      </div>
      <Select
        v-else
        :model-value="currentTeam?.id"
        @update:model-value="switchTeam"
      >
        <SelectTrigger class="w-full">
          <SelectValue placeholder="Select team" />
        </SelectTrigger>
        <SelectContent>
          <SelectLabel v-if="computedTeams.length === 0">
            No teams available
          </SelectLabel>
          <SelectItem
            v-for="team in computedTeams"
            :key="team.value"
            :value="team.value"
          >
            <div class="flex items-center gap-2">
              <Avatar class="size-5">
                <AvatarImage
                  :src="team.original?.photoURL!"
                  :alt="team.label"
                  referrerpolicy="no-referrer"
                />
                <AvatarFallback>
                  {{ getInitials(team.label) }}
                </AvatarFallback>
              </Avatar>
              {{ team.label }}
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <div class="grid">
              <Button
                variant="secondary"
                class="justify-start"
                :disabled="!canCreateTeam"
                @click="isCreatingTeamDialogOpen = true"
              >
                <IconCirclePlus />
                Create team
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent v-if="!canCreateTeam">
            {{ getCannotCreateTeamReason }}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </EmptyContent>
    <Button
      variant="outline"
      size="sm"
      @click="emitter.emit('Dialog.Exit.Open')"
    >
      <IconLogOut />
      Log out
    </Button>
    <TeamDialog v-model:open="isCreatingTeamDialogOpen" mode="create" />
  </Empty>
</template>
