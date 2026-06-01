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
import { firestore } from "@/modules/firebase"
import { emitter } from "@/modules/mitt"
import { doc } from "firebase/firestore"
import { useDocumentQuery } from "@/utils/firebase/firebase-query"
import { useCurrentUser } from "vuefire"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Profile",
    breadcrumb: "Profile",
  },
})

useHead({
  title: "Profile",
})

const { t } = useI18n()

const user = useCurrentUser()
const userDocRef = computed(() =>
  user.value ? doc(firestore, "users", user.value.uid) : null
)
const { data: userData } = useDocumentQuery(userDocRef)
const isPublic = computed(() => userData.value?.isPublic ?? false)
const username = computed(() => userData.value?.username ?? "")
const {
  memberships,
  currentTeam,
  isLoading: isTeamsLoading,
  getTeamMemberCount,
} = useTeamActions()
</script>

<template>
  <div class="flex flex-col items-center justify-center p-2">
    <div
      class="aspect-video max-h-40 w-full border bg-[repeating-linear-gradient(45deg,var(--color-muted)_0,var(--color-muted)_1px,transparent_0,transparent_50%)] bg-size-[8px_8px]"
    ></div>
    <div class="bg-background -mt-10border mx-auto p-1">
      <Avatar class="size-20">
        <AvatarImage
          class="size-20"
          :src="user?.photoURL!"
          :alt="user?.displayName"
          referrerpolicy="no-referrer"
        />
        <AvatarFallback class="size-20">
          {{ getInitials(user?.displayName!) }}
        </AvatarFallback>
      </Avatar>
    </div>
  </div>
  <div
    class="mx-auto flex max-w-2xl flex-col items-center justify-center gap-2 p-4"
  >
    <h1 class="text-2xl font-bold tracking-tight">
      {{ user?.displayName }}
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
        {{ isPublic ? t("pages.profile.public") : t("pages.profile.private") }}
      </Badge>
      <Badge
        variant="outline"
        @click="emitter.emit('Dialog.Settings.Open', 'account')"
      >
        <IconSettings />
        {{ t("actions.settings") }}
      </Badge>
    </div>
    <div class="text-muted-foreground flex items-center gap-1">
      <IconUsers />
      <span>
        {{ t("pages.profile.teamCount", { count: memberships.length }) }}
      </span>
    </div>
  </div>
  <div class="mx-auto flex w-full max-w-md flex-col gap-2 p-2">
    <div v-if="isTeamsLoading" class="flex justify-center p-4">
      <Spinner />
    </div>
    <ItemGroup
      v-else-if="memberships.length > 0"
      class="grid grid-cols-1 gap-2"
    >
      <Item v-for="membership in memberships" :key="membership.teamId" as-child>
        <RouterLink :to="`/teams/${membership.teamId}`">
          <ItemMedia>
            <Avatar>
              <AvatarImage
                :src="membership.team.photoURL!"
                :alt="membership.team.name"
                referrerpolicy="no-referrer"
              />
              <AvatarFallback>
                {{ getInitials(membership.team.name) }}
              </AvatarFallback>
            </Avatar>
          </ItemMedia>
          <ItemContent class="gap-0.5 truncate">
            <ItemTitle class="truncate">
              {{ membership.team.name }}
            </ItemTitle>
            <ItemDescription class="truncate text-xs">
              {{
                t("pages.teams.memberCount", {
                  count: getTeamMemberCount(membership.teamId),
                })
              }}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Badge
              v-if="currentTeam?.id === membership.teamId"
              variant="secondary"
            >
              {{ t("pages.teams.active") }}
            </Badge>
            <Badge variant="outline">
              {{ t(`components.teamDialog.roles.${membership.role}`) }}
            </Badge>
          </ItemActions>
        </RouterLink>
      </Item>
    </ItemGroup>
    <p v-else class="text-muted-foreground text-center text-sm">
      {{ t("pages.profile.noTeams") }}
    </p>
  </div>
</template>
