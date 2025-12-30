<script lang="ts" setup>
import TeamDialog from "@/components/app/teams/TeamDialog.vue"
import { getInitials } from "@/helpers/utilities"
import { auth } from "@/modules/firebase"
import { useTeamStore } from "@/stores/teamStore"
import { signOut } from "firebase/auth"
import { storeToRefs } from "pinia"
import { computed, ref } from "vue"
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

const handleSignOut = async () => {
  try {
    await signOut(auth)
  } catch (_error) {
    toast.error("Failed to sign out")
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
        <div class="space-y-1 p-2">
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
              class="w-full justify-start"
              @click="switchTeam(team.value)"
            >
              <Avatar class="size-8">
                <AvatarImage
                  :src="team.original.photoURL!"
                  referrerpolicy="no-referrer"
                  :alt="team.label"
                />
                <AvatarFallback>
                  {{ getInitials(team.label) }}
                </AvatarFallback>
              </Avatar>
              <span class="flex-1 truncate font-medium">{{ team.label }}</span>
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
        <Button variant="ghost" size="sm" @click="handleSignOut">
          Sign out
        </Button>
      </div>
    </div>
    <TeamDialog v-model:open="isCreatingTeamDialogOpen" mode="create" />
  </div>
</template>
