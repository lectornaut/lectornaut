<script lang="ts" setup>
import TeamDialog from "@/components/app/teams/TeamDialog.vue"
import { IconCirclePlus, IconLogOut } from "@/data/icons"
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

const handleSwitchTeam = async (teamId: string) => {
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
        <h1 class="text-2xl font-semibold tracking-tight">Select a Team</h1>
        <p class="text-muted-foreground text-sm">
          Choose a team to continue or create a new one.
        </p>
      </div>

      <div class="bg-card text-card-foreground rounded-lg border shadow-sm">
        <div class="space-y-1 p-2">
          <div v-if="isLoading" class="flex justify-center p-4">
            <Spinner />
          </div>

          <template v-else>
            <div
              v-if="teams.length === 0"
              class="text-muted-foreground p-4 text-center text-sm"
            >
              You don't have any teams yet.
            </div>

            <button
              v-for="team in teams"
              :key="team.value"
              class="hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-3 rounded-md p-2 text-left text-sm transition-colors"
              @click="handleSwitchTeam(team.value)"
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
            </button>
          </template>
        </div>

        <div class="bg-muted/20 border-t p-2">
          <button
            class="hover:bg-accent hover:text-accent-foreground text-primary flex w-full items-center justify-center gap-2 rounded-md p-2 text-sm font-medium transition-colors"
            @click="isCreatingTeamDialogOpen = true"
          >
            <IconCirclePlus class="size-4" />
            Create New Team
          </button>
        </div>
      </div>

      <div class="text-center">
        <Button
          variant="link"
          size="sm"
          class="text-muted-foreground"
          @click="handleSignOut"
        >
          <IconLogOut class="mr-2 size-3" />
          Sign out
        </Button>
      </div>
    </div>
    <TeamDialog v-model:open="isCreatingTeamDialogOpen" mode="create" />
  </div>
</template>
