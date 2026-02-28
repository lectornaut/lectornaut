<script lang="ts" setup>
import { useTeamActions } from "@/composables/useTeamActions"
import {
  IconAtSign,
  IconGlobe,
  IconLock,
  IconSettings,
  IconUsers,
} from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import { emitter } from "@/modules/mitt"
import { useMembershipStore } from "@/stores/membershipStore"
import type { ITeam } from "@/types/domain"
import type { IMembership } from "@/types/membership"
import { useCurrentUser } from "vuefire"

const route = useRoute()
const router = useRouter()
const user = useCurrentUser()
const membershipStore = useMembershipStore()

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
const { canUpdateTeam } = useTeamActions()

// Fetch team data and members
const team = ref<ITeam | null>(null)
const isLoading = ref(true)
const isMember = ref(false)
const teamMembers = ref<IMembership[]>([])
const isPublic = computed(() => team.value?.isPublic ?? false)
const username = computed(() => team.value?.username ?? "")

// Check if current user is a member of this team
onMounted(async () => {
  try {
    isLoading.value = true

    // Check if user is a member of this team
    const membership = membershipStore.memberships.find(
      (m) => m.teamId === teamId.value && m.userId === user.value?.uid
    )

    if (!membership) {
      // User is not a member, redirect to teams list
      router.push("/teams")
      return
    }

    isMember.value = true
    team.value = membership.team

    // Load all members for this specific team
    teamMembers.value = await membershipStore.getMembersForTeam(teamId.value)
  } catch (error) {
    console.error("Failed to load team:", error)
    router.push("/teams")
  } finally {
    isLoading.value = false
  }
})
</script>

<template>
  <!-- Loading State -->
  <div v-if="isLoading" class="flex justify-center p-12">
    <Spinner />
  </div>

  <!-- Team Profile -->
  <div v-else-if="team && isMember">
    <!-- Team Header -->
    <div class="flex flex-col items-center justify-center p-2">
      <div
        class="aspect-video max-h-40 w-full rounded-md border bg-[repeating-linear-gradient(45deg,var(--muted)_0,var(--muted)_1px,transparent_0,transparent_50%)] bg-size-[8px_8px]"
      ></div>
      <div class="bg-background mx-auto -mt-10 rounded border p-1">
        <Avatar class="size-20 rounded">
          <AvatarImage
            class="size-20 rounded"
            :src="team.photoURL!"
            :alt="team.name"
            referrerpolicy="no-referrer"
          />
          <AvatarFallback class="size-20 rounded">
            {{ getInitials(team.name) }}
          </AvatarFallback>
        </Avatar>
      </div>
    </div>

    <!-- Team Info -->
    <div class="mx-auto flex flex-col items-center justify-center gap-2 p-4">
      <h1 class="text-2xl font-bold tracking-tight">
        {{ team.name }}
      </h1>
      <Badge variant="secondary" as-child>
        <a
          v-if="username"
          :href="`/${username}`"
          target="_blank"
          rel="noopener noreferrer"
          class="text-muted-foreground"
        >
          <IconAtSign />
          {{ username }}
        </a>
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
          v-if="canUpdateTeam"
          variant="outline"
          @click="emitter.emit('Dialog.Settings.Open', 'overview')"
        >
          <IconSettings />
          {{ t("actions.settings") }}
        </Badge>
      </div>
      <div class="text-muted-foreground flex items-center gap-1">
        <IconUsers class="size-4" />
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
            <Avatar class="rounded">
              <AvatarImage
                class="rounded"
                :src="membership.user.photoURL!"
                :alt="membership.user.displayName"
                referrerpolicy="no-referrer"
              />
              <AvatarFallback class="rounded">
                {{ getInitials(membership.user.displayName!) }}
              </AvatarFallback>
            </Avatar>
          </ItemMedia>
          <ItemContent class="gap-0.5 truncate">
            <ItemTitle class="truncate">
              {{ membership.user.displayName }}
            </ItemTitle>
            <ItemDescription class="truncate text-xs">
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
