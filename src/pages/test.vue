<script lang="ts" setup>
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamStore } from "@/stores/teamStore"
import { storeToRefs } from "pinia"

const { t } = useI18n()

const teamStore = useTeamStore()
const membershipStore = useMembershipStore()
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
    if (!currentTeam.value) throw new Error("No current team")
    await membershipStore.inviteMember(
      currentTeam.value.id,
      currentTeam.value,
      inviteEmail.value
    )
    inviteSuccess.value = true
    inviteEmail.value = ""
  } catch (e: unknown) {
    inviteError.value = (e as Error).message
  } finally {
    isInviting.value = false
  }
}

const switchTeam = async (teamId: string) => {
  await teamStore.switchTeam(teamId)
}
</script>

<template>
  <div class="space-y-8 p-8">
    <div v-if="isLoading" class="flex justify-center">
      <Spinner />
    </div>

    <div v-else-if="!currentUser" class="text-center">
      <p>{{ t("pages.test.signInPrompt") }}</p>
      <!-- Add a temporary sign in button if needed, or assume global auth handling -->
    </div>

    <div v-else class="space-y-8">
      <!-- User Info -->
      <section class="rounded-lg border p-4">
        <h2 class="mb-2 text-xl font-bold">
          {{ t("pages.test.userProfile") }}
        </h2>
        <p>
          <strong>{{ t("pages.test.uid") }}:</strong> {{ userProfile?.uid }}
        </p>
        <p>
          <strong>{{ t("labels.email") }}:</strong> {{ userProfile?.email }}
        </p>
        <p>
          <strong>{{ t("pages.test.currentTeamId") }}:</strong>
          {{ userProfile?.currentTeamId || t("common.none") }}
        </p>
      </section>

      <!-- Current Team -->
      <section class="rounded-lg border bg-slate-50 p-4">
        <h2 class="mb-2 text-xl font-bold">
          {{ t("pages.test.currentTeam") }}
        </h2>
        <div v-if="currentTeam">
          <h3 class="text-primary text-2xl font-bold">
            {{ currentTeam.name }}
          </h3>
          <p class="text-muted-foreground text-sm">
            {{ t("pages.test.id") }}: {{ currentTeam.id }}
          </p>

          <div class="mt-4">
            <h4 class="mb-2 font-semibold">{{ t("labels.members") }}</h4>
            <ul class="space-y-1">
              <li
                v-for="member in teamMembers"
                :key="member.userId"
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
            <h4 class="mb-2 font-semibold">
              {{ t("pages.test.inviteMember") }}
            </h4>
            <div class="flex gap-2">
              <Input
                v-model="inviteEmail"
                :placeholder="t('pages.test.userEmail')"
                @keyup.enter="handleInvite"
              />
              <Button :disabled="isInviting" @click="handleInvite">
                {{
                  isInviting ? t("pages.test.inviting") : t("actions.invite")
                }}
              </Button>
            </div>
            <p v-if="inviteError" class="text-destructive mt-1 text-sm">
              {{ inviteError }}
            </p>
            <p v-if="inviteSuccess" class="mt-1 text-sm text-green-600">
              {{ t("pages.test.inviteSuccess") }}
            </p>
          </div>
        </div>
        <div v-else>
          <p>{{ t("pages.test.noTeamSelected") }}</p>
        </div>
      </section>

      <!-- Create Team -->
      <section class="rounded-lg border p-4">
        <h2 class="mb-2 text-xl font-bold">
          {{ t("pages.test.createNewTeam") }}
        </h2>
        <div class="flex gap-2">
          <Input
            v-model="newTeamName"
            :placeholder="t('pages.test.teamName')"
            @keyup.enter="handleCreateTeam"
          />
          <Button @click="handleCreateTeam">{{ t("actions.create") }}</Button>
        </div>
      </section>

      <!-- My Teams -->
      <section class="rounded-lg border p-4">
        <h2 class="mb-2 text-xl font-bold">{{ t("pages.test.myTeams") }}</h2>
        <ul class="space-y-2">
          <li
            v-for="membership in memberships"
            :key="membership.teamId"
            class="flex items-center justify-between rounded border p-3 transition hover:bg-slate-50"
          >
            <div>
              <div class="font-medium">{{ membership.team.name }}</div>
              <div class="text-muted-foreground text-xs">
                {{ t("pages.test.role") }}: {{ membership.role }}
              </div>
            </div>
            <Button
              v-if="membership.teamId !== currentTeam?.id"
              variant="outline"
              size="sm"
              @click="switchTeam(membership.teamId)"
            >
              {{ t("actions.switch") }}
            </Button>
            <span v-else class="text-sm font-medium text-green-600">{{
              t("labels.active")
            }}</span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
