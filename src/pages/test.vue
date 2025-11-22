<script lang="ts" setup>
import { useTeamStore } from "@/stores/teamStore"
import { storeToRefs } from "pinia"
import { ref } from "vue"

const teamStore = useTeamStore()
const {
  currentUser,
  userProfile,
  currentTeam,
  memberships,
  teamMembers,
  isLoading,
} = storeToRefs(teamStore)

const newTeamName = ref("")
const inviteEmail = ref("")
const isInviting = ref(false)
const inviteError = ref("")
const inviteSuccess = ref(false)

const handleCreateTeam = async () => {
  if (!newTeamName.value.trim()) return
  await teamStore.createTeam(newTeamName.value)
  newTeamName.value = ""
}

const handleInvite = async () => {
  if (!inviteEmail.value.trim()) return

  isInviting.value = true
  inviteError.value = ""
  inviteSuccess.value = false

  try {
    await teamStore.inviteMember(inviteEmail.value)
    inviteSuccess.value = true
    inviteEmail.value = ""
  } catch (e: unknown) {
    inviteError.value = (e as Error).message
  } finally {
    isInviting.value = false
  }
}

const handleSwitchTeam = async (teamId: string) => {
  await teamStore.switchTeam(teamId)
}
</script>

<template>
  <div class="space-y-8 p-8">
    <div v-if="isLoading" class="flex justify-center">
      <Spinner />
    </div>

    <div v-else-if="!currentUser" class="text-center">
      <p>Please sign in to manage teams.</p>
      <!-- Add a temporary sign in button if needed, or assume global auth handling -->
    </div>

    <div v-else class="space-y-8">
      <!-- User Info -->
      <section class="rounded-lg border p-4">
        <h2 class="mb-2 text-xl font-bold">User Profile</h2>
        <p><strong>UID:</strong> {{ userProfile?.uid }}</p>
        <p><strong>Email:</strong> {{ userProfile?.email }}</p>
        <p>
          <strong>Current Team ID:</strong>
          {{ userProfile?.currentTeamId || "None" }}
        </p>
      </section>

      <!-- Current Team -->
      <section class="rounded-lg border bg-slate-50 p-4">
        <h2 class="mb-2 text-xl font-bold">Current Team</h2>
        <div v-if="currentTeam">
          <h3 class="text-primary text-2xl font-bold">
            {{ currentTeam.name }}
          </h3>
          <p class="text-muted-foreground text-sm">ID: {{ currentTeam.id }}</p>

          <div class="mt-4">
            <h4 class="mb-2 font-semibold">Members</h4>
            <ul class="space-y-1">
              <li
                v-for="member in teamMembers"
                :key="member.id"
                class="flex items-center justify-between rounded border bg-white p-2"
              >
                <span>
                  {{ member.user.displayName || member.user.email }}
                  <span class="text-muted-foreground text-xs"
                    >({{ member.role }})</span
                  >
                </span>
              </li>
            </ul>
          </div>

          <div class="mt-4 border-t pt-4">
            <h4 class="mb-2 font-semibold">Invite Member</h4>
            <div class="flex gap-2">
              <Input
                v-model="inviteEmail"
                placeholder="User Email"
                @keyup.enter="handleInvite"
              />
              <Button :disabled="isInviting" @click="handleInvite">
                {{ isInviting ? "Inviting..." : "Invite" }}
              </Button>
            </div>
            <p v-if="inviteError" class="text-destructive mt-1 text-sm">
              {{ inviteError }}
            </p>
            <p v-if="inviteSuccess" class="mt-1 text-sm text-green-600">
              User invited successfully!
            </p>
          </div>
        </div>
        <div v-else>
          <p>No team selected.</p>
        </div>
      </section>

      <!-- Create Team -->
      <section class="rounded-lg border p-4">
        <h2 class="mb-2 text-xl font-bold">Create New Team</h2>
        <div class="flex gap-2">
          <Input
            v-model="newTeamName"
            placeholder="Team Name"
            @keyup.enter="handleCreateTeam"
          />
          <Button @click="handleCreateTeam">Create</Button>
        </div>
      </section>

      <!-- My Teams -->
      <section class="rounded-lg border p-4">
        <h2 class="mb-2 text-xl font-bold">My Teams</h2>
        <ul class="space-y-2">
          <li
            v-for="membership in memberships"
            :key="membership.id"
            class="flex items-center justify-between rounded border p-3 transition hover:bg-slate-50"
          >
            <div>
              <div class="font-medium">{{ membership.team.name }}</div>
              <div class="text-muted-foreground text-xs">
                Role: {{ membership.role }}
              </div>
            </div>
            <Button
              v-if="membership.teamId !== currentTeam?.id"
              variant="outline"
              size="sm"
              @click="handleSwitchTeam(membership.teamId)"
            >
              Switch
            </Button>
            <span v-else class="text-sm font-medium text-green-600"
              >Active</span
            >
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
