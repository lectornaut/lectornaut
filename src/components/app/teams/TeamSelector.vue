<script lang="ts" setup>
import TeamDialog from "@/components/app/teams/TeamDialog.vue"
import { getInitials } from "@/helpers/utilities"
import { logout } from "@/modules/auth"
import { useTeamStore } from "@/stores/teamStore"
import { storeToRefs } from "pinia"
import { toast } from "vue-sonner"

const teamStore = useTeamStore()
const { memberships, isLoading } = storeToRefs(teamStore)

const isCreatingTeamDialogOpen = ref(false)

const teams = computed(() =>
  memberships.value.map((m) => ({
    label: m.team.name,
    value: m.team.id,
    original: m.team,
  }))
)

const switchTeam = async (teamId: string) => {
  try {
    await teamStore.switchTeam(teamId)
  } catch (_error) {
    toast.error("Failed to switch team")
  }
}
</script>

<template>
  <div>
    <div class="w-full max-w-sm space-y-4">
      <div class="space-y-2 text-center">
        <h1 class="text-2xl font-bold tracking-tight">Teams</h1>
        <p class="text-muted-foreground text-xs">
          Choose a team to continue or create a new one.
        </p>
      </div>
      <div class="bg-background rounded-lg border">
        <div class="p-2">
          <div v-if="isLoading" class="flex justify-center p-4">
            <Spinner />
          </div>
          <template v-else>
            <div
              v-if="teams.length === 0"
              class="text-muted-foreground p-4 text-center"
            >
              You are not a member of any teams.
            </div>
            <Button
              v-for="team in teams"
              :key="team.value"
              variant="ghost"
              size="lg"
              class="w-full justify-start p-3"
              @click="switchTeam(team.value)"
            >
              <Avatar class="size-5">
                <AvatarImage
                  v-if="team.original.photoURL"
                  :src="team.original.photoURL"
                  :alt="team.label"
                  referrerpolicy="no-referrer"
                />
                <AvatarFallback>
                  {{ getInitials(team.label) }}
                </AvatarFallback>
              </Avatar>
              {{ team.label }}
            </Button>
          </template>
        </div>
        <Separator />
        <div class="grid p-2">
          <Button @click="isCreatingTeamDialogOpen = true">
            Create a new team
          </Button>
        </div>
      </div>
      <div class="text-center">
        <Button variant="ghost" size="sm" @click="logout()"> Sign out </Button>
      </div>
    </div>
    <TeamDialog v-model:open="isCreatingTeamDialogOpen" mode="create" />
  </div>
</template>
