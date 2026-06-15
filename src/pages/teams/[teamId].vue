<script lang="ts" setup>
import {
  IconAtSign,
  IconGlobe,
  IconLock,
  IconSettings,
  IconUsers,
} from "@/data/icons"
import { emitter } from "@/modules/mitt"
import { useMembershipStore } from "@/stores/membershipStore"
import { isUserMembership, type IMembership } from "@/types/membership"
import { storeToRefs } from "pinia"
import { useCurrentUser } from "vuefire"

const route = useRoute()
const router = useRouter()
const user = useCurrentUser()
const membershipStore = useMembershipStore()
const { memberships, isLoading: isMembershipsLoading } =
  storeToRefs(membershipStore)

const teamId = computed(() => route.params.teamId as string)

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Teams",
    breadcrumb: (route: { params: { teamId: string } }) =>
      `Team ${route?.params.teamId}`,
  },
})

useHead({
  title: "Team",
})

const { t } = useI18n()

// Fetch team data and members
const isLoading = ref(true)
const teamMembers = ref<IMembership[]>([])
const loadedMembersTeamId = ref<string | null>(null)
let memberLoadRequestId = 0

const currentMembership = computed(() => {
  const userId = user.value?.uid
  if (!userId) return null
  return (
    memberships.value.find(
      (membership) =>
        membership.teamId === teamId.value && membership.userId === userId
    ) ?? null
  )
})

const team = computed(() => currentMembership.value?.team ?? null)
const isMember = computed(() => !!currentMembership.value)
const isPublic = computed(() => team.value?.isPublic ?? false)
const username = computed(() => team.value?.username ?? "")

watch(teamId, () => {
  if (loadedMembersTeamId.value !== teamId.value) {
    teamMembers.value = []
  }
})

watch(
  [teamId, () => user.value?.uid, isMembershipsLoading, isMember],
  async ([nextTeamId, userId, membershipsLoading, member]) => {
    if (!userId) {
      isLoading.value = false
      teamMembers.value = []
      loadedMembersTeamId.value = null
      return
    }

    if (membershipsLoading) {
      isLoading.value = true
      return
    }

    if (!member) {
      isLoading.value = false
      teamMembers.value = []
      loadedMembersTeamId.value = null
      if (router.currentRoute.value.path !== "/teams") {
        void router.replace("/teams")
      }
      return
    }

    if (loadedMembersTeamId.value === nextTeamId) {
      isLoading.value = false
      return
    }

    const requestId = ++memberLoadRequestId
    isLoading.value = true

    try {
      const members = await membershipStore.getMembersForTeam(nextTeamId)
      if (requestId !== memberLoadRequestId) return
      // The public team page lists human members only; agent memberships
      // are an internal/admin concept and don't surface on public profiles.
      teamMembers.value = members.filter(isUserMembership)
      loadedMembersTeamId.value = nextTeamId
    } catch (error) {
      if (requestId !== memberLoadRequestId) return
      console.error("Failed to load team members:", error)
      teamMembers.value = []
    } finally {
      if (requestId === memberLoadRequestId) {
        isLoading.value = false
      }
    }
  },
  { immediate: true }
)
</script>

<template>
  <!-- Loading State -->
  <LoadingState v-if="isLoading" />

  <!-- Team Profile -->
  <div v-else-if="team && isMember">
    <!-- Team Header -->
    <div class="flex flex-col items-center justify-center p-2">
      <div
        class="aspect-video max-h-40 w-full rounded-2xl border bg-[repeating-linear-gradient(45deg,var(--color-muted)_0,var(--color-muted)_1px,transparent_0,transparent_50%)] bg-size-[8px_8px]"
      ></div>
      <div class="bg-background mx-auto -mt-10 rounded-full border p-1">
        <AppAvatar class="size-20" :src="team.photoURL" :name="team.name" />
      </div>
    </div>

    <!-- Team Info -->
    <div class="mx-auto flex flex-col items-center justify-center gap-2 p-4">
      <h1 class="text-2xl font-bold tracking-tight">
        {{ team.name }}
      </h1>
      <Badge variant="secondary" as-child>
        <RouterLink
          v-if="username"
          :to="`/${username}`"
          rel="noopener noreferrer"
          class="text-muted-foreground"
        >
          <IconAtSign />
          {{ username }}
        </RouterLink>
        <span v-else> {{ t("pages.profile.noUsername") }} </span>
      </Badge>
      <div class="flex items-center gap-2">
        <Badge variant="secondary">
          <IconGlobe v-if="isPublic" />
          <IconLock v-else />
          {{
            isPublic ? t("pages.profile.public") : t("pages.profile.private")
          }}
        </Badge>
        <Badge
          variant="outline"
          @click="emitter.emit('Dialog.Settings.Open', 'overview')"
        >
          <IconSettings />
          {{ t("actions.settings") }}
        </Badge>
      </div>
      <div class="text-muted-foreground flex items-center gap-1">
        <IconUsers />
        <span>
          {{ t("pages.teams.memberCount", { count: teamMembers.length }) }}
        </span>
      </div>
    </div>

    <!-- Team Members -->
    <div class="mx-auto flex w-full max-w-md flex-col gap-2 p-2">
      <ItemGroup class="grid grid-cols-1 gap-2">
        <Item
          v-for="membership in teamMembers"
          :key="membership.userId"
          variant="muted"
        >
          <ItemMedia>
            <AppAvatar
              :src="membership.user.photoURL"
              :name="membership.user.displayName"
            />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>
              {{ membership.user.displayName }}
            </ItemTitle>
            <ItemDescription class="text-xs">
              {{ membership.user.email }}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Badge v-if="membership.userId === user?.uid" variant="secondary">
              {{ t("pages.teams.you") }}
            </Badge>
            <Badge variant="outline">
              {{ t(`components.teamDialog.roles.${membership.role}`) }}
            </Badge>
          </ItemActions>
        </Item>
      </ItemGroup>
    </div>
  </div>
</template>
