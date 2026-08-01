<script lang="ts" setup>
import {
  getPublicTeamMembers,
  getPublicTeamsForUser,
  type PublicProfileMember,
  type PublicProfileTeam,
} from "@/composables/useFunctions"
import { useTeamActions } from "@/composables/useTeamActions"
import { IconAtSign, IconGlobe, IconLock, IconSettings } from "@/data/icons"
import { firestore } from "@/modules/firebase"
import {
  getTeamByUsername,
  getUserByUsername,
  type TeamFetchResult,
  type UserFetchResult,
} from "@/queries/username"
import type { DocumentData } from "firebase/firestore"
import { doc } from "firebase/firestore"
import { useRoute, useRouter } from "vue-router"
import { useDocumentQuery } from "@/utils/firebase/firebase-query"
import { useCurrentUser, useIsCurrentUserLoaded } from "vuefire"

definePage({
  // Public profile renders its own PageHeader, so no surrounding layout.
  meta: {
    layout: false,
  },
})

const route = useRoute()
const router = useRouter()
const isAuthLoaded = useIsCurrentUserLoaded()
const { t } = useI18n()

const currentUser = useCurrentUser()
const currentUserRef = computed(() =>
  currentUser.value ? doc(firestore, "users", currentUser.value.uid) : null
)
const { data: currentUserData } = useDocumentQuery(currentUserRef)

const username = computed(() => {
  const name = (route.params as { username?: string }).username || ""
  return name && name.startsWith("@") ? name.slice(1) : name
})
const rawUsernameSegment = computed(() => {
  const name = (route.params as { username?: string }).username || ""
  return name
})

const loading = ref(!!username.value)
const user = ref<DocumentData | null>(null)
const team = ref<DocumentData | null>(null)
const viewedTeamId = ref<string | null>(null)
const entityType = ref<"user" | "team" | null>(null)
const isPrivate = ref(false)
const error = ref<string | null>(null)
const profileMembers = ref<PublicProfileMember[]>([])
const profileMemberCount = ref(0)
const profileTeams = ref<PublicProfileTeam[]>([])
const profileTeamCount = ref(0)
let fetchRequestId = 0
let profileHeaderRequestId = 0

const targetTeamId = computed(() =>
  entityType.value === "team" ? viewedTeamId.value : null
)
const { canUpdateTeam } = useTeamActions(targetTeamId)

const isCurrentUser = computed(() => {
  if (entityType.value !== "user" || !currentUser.value) return false

  const viewedUserId =
    typeof user.value?.uid === "string" ? user.value.uid : null
  if (viewedUserId) {
    return currentUser.value.uid === viewedUserId
  }

  return (
    currentUserData.value?.username?.trim().toLowerCase() ===
    username.value.trim().toLowerCase()
  )
})

const settingsRoute = computed(() => {
  if (isCurrentUser.value) return "/profile"
  if (entityType.value === "team" && canUpdateTeam.value) return "/teams"
  return null
})

const displayName = computed(() => {
  if (user.value?.displayName) return user.value.displayName
  if (team.value?.name) return team.value.name
  if (isPrivate.value) {
    return t("pages.publicProfile.privateTitle")
  }
  return username.value || t("pages.publicProfile.title")
})

const isPublicProfile = computed(
  () => user.value?.isPublic || team.value?.isPublic || false
)
const shouldShowUsername = computed(
  () => !error.value && !isPrivate.value && !!username.value
)
const profileStackMode = computed<"members" | "teams" | null>(() => {
  if (entityType.value === "team") return "members"
  if (entityType.value === "user") return "teams"
  return null
})
const profileTeamId = computed(() => {
  return entityType.value === "team" ? viewedTeamId.value : null
})
const profileUserId = computed(() =>
  entityType.value === "user" && typeof user.value?.uid === "string"
    ? user.value.uid
    : null
)
const headerAvatars = computed(() =>
  profileStackMode.value === "members"
    ? profileMembers.value.map((member) => ({
        id: member.userId,
        name: member.displayName,
        photoURL: member.photoURL,
      }))
    : profileTeams.value.map((team) => ({
        id: team.teamId,
        name: team.name,
        photoURL: team.photoURL,
      }))
)
const headerCount = computed(() =>
  profileStackMode.value === "members"
    ? profileMemberCount.value
    : profileTeamCount.value
)
const visibleHeaderAvatars = computed(() => headerAvatars.value.slice(0, 3))
const hiddenHeaderAvatarNames = computed(() =>
  headerAvatars.value
    .slice(visibleHeaderAvatars.value.length)
    .map((avatar) => avatar.name || avatar.id)
)
const hiddenHeaderAvatarCount = computed(() =>
  Math.max(headerCount.value - visibleHeaderAvatars.value.length, 0)
)

watch(username, () => {
  user.value = null
  team.value = null
  viewedTeamId.value = null
  entityType.value = null
  isPrivate.value = false
  error.value = null
  profileMembers.value = []
  profileMemberCount.value = 0
  profileTeams.value = []
  profileTeamCount.value = 0
  loading.value = !!username.value
})

watch(
  [profileStackMode, profileTeamId, profileUserId],
  async ([mode, teamId, userId]) => {
    const requestId = ++profileHeaderRequestId
    profileMembers.value = []
    profileMemberCount.value = 0
    profileTeams.value = []
    profileTeamCount.value = 0

    if (mode === "members" && teamId) {
      try {
        const response = await getPublicTeamMembers({ teamId })
        if (requestId !== profileHeaderRequestId) return

        const members = (
          Array.isArray(response.data?.members) ? response.data.members : []
        ).filter((member): member is PublicProfileMember => !!member)

        profileMembers.value = members
        profileMemberCount.value = Math.max(
          typeof response.data?.memberCount === "number"
            ? response.data.memberCount
            : members.length,
          members.length
        )
      } catch (err) {
        if (requestId !== profileHeaderRequestId) return
        console.error("Failed to load team members for profile:", err)
      }
      return
    }

    if (mode === "teams" && userId) {
      try {
        const response = await getPublicTeamsForUser({ userId })
        if (requestId !== profileHeaderRequestId) return

        const teams = (
          Array.isArray(response.data?.teams) ? response.data.teams : []
        ).filter((team): team is PublicProfileTeam => !!team)

        profileTeams.value = teams
        profileTeamCount.value = Math.max(
          typeof response.data?.teamCount === "number"
            ? response.data.teamCount
            : teams.length,
          teams.length
        )
      } catch (err) {
        if (requestId !== profileHeaderRequestId) return
        console.error("Failed to load profile teams:", err)
      }
    }
  },
  { immediate: true }
)

const fetchPublicProfile = async () => {
  if (!username.value) {
    loading.value = false
    error.value = t("pages.publicProfile.invalidUsername")
    return
  }

  const requestId = ++fetchRequestId
  loading.value = true
  error.value = null

  try {
    const result: UserFetchResult = await getUserByUsername(username.value)
    if (requestId !== fetchRequestId) return

    switch (result.status) {
      case "found":
        user.value = result.data
        entityType.value = "user"
        break
      case "private":
        isPrivate.value = true
        entityType.value = "user"
        break
      case "not_found":
        {
          const teamResult: TeamFetchResult = await getTeamByUsername(
            username.value
          )
          if (requestId !== fetchRequestId) return

          switch (teamResult.status) {
            case "found":
              team.value = teamResult.data
              viewedTeamId.value = teamResult.teamId
              entityType.value = "team"
              break
            case "private":
              isPrivate.value = true
              viewedTeamId.value = teamResult.teamId ?? null
              entityType.value = "team"
              break
            case "not_found":
              // Switch to catch-all route while keeping the same URL.
              await router.replace({
                name: "/[...path]",
                params: {
                  path: rawUsernameSegment.value || username.value,
                },
                query: route.query,
                hash: route.hash,
              })
              if (requestId !== fetchRequestId) return
              return
            case "error":
              error.value =
                teamResult.message || t("pages.publicProfile.fetchError")
              break
          }
        }
        break
      case "error":
        error.value = result.message || t("pages.publicProfile.fetchError")
        break
    }
  } catch (err) {
    if (requestId !== fetchRequestId) return
    console.error("Error fetching user:", err)
    error.value = t("pages.publicProfile.fetchError")
  } finally {
    if (requestId === fetchRequestId) {
      loading.value = false
    }
  }
}

// Watch for username and auth state - only fetch after auth has loaded
// This ensures auth.currentUser is available for private profile checks
watch(
  [username, isAuthLoaded],
  ([newUsername, authLoaded]) => {
    if (!authLoaded) return
    if (!newUsername) {
      loading.value = false
      error.value = t("pages.publicProfile.invalidUsername")
      return
    }
    void fetchPublicProfile()
  },
  { immediate: true }
)

useHead(() => ({
  title: isPrivate.value
    ? t("pages.publicProfile.privateTitle")
    : username.value
      ? `@${username.value}`
      : t("pages.publicProfile.title"),
}))
</script>

<template>
  <div class="flex grow flex-col items-center">
    <PageHeader />
    <div class="w-full max-w-2xl px-2">
      <!-- Loading State -->
      <template v-if="loading">
        <LoadingState class="h-screen" />
      </template>
      <!-- Shared profile header -->
      <template v-else>
        <div class="flex flex-col items-center justify-center p-2">
          <div
            class="bg-background flex aspect-video max-h-40 w-full flex-col rounded-4xl border shadow-xs"
          >
            <div class="flex items-center justify-between p-2">
              <Logo class="size-8 shrink-0 p-2" />
              <Button
                v-if="settingsRoute"
                variant="outline"
                @click="router.push(settingsRoute)"
              >
                <IconSettings />
                {{ t("pages.publicProfile.settings") }}
              </Button>
            </div>
            <div class="flex grow items-center justify-between p-2"></div>
            <div
              v-if="headerAvatars.length > 0"
              class="flex items-center justify-between p-2"
            >
              <div v-if="error" class="flex flex-col items-center gap-2">
                <p class="text-muted-foreground text-sm">{{ error }}</p>
                <Button variant="outline" @click="fetchPublicProfile">
                  {{ t("pages.publicProfile.retry") }}
                </Button>
              </div>
              <div v-else class="flex items-center gap-2">
                <Badge variant="secondary">
                  <IconGlobe v-if="isPublicProfile" />
                  <IconLock v-else />
                  {{
                    isPublicProfile
                      ? t("pages.publicProfile.public")
                      : t("pages.publicProfile.private")
                  }}
                </Badge>
              </div>
              <div class="flex items-center gap-2">
                <span>
                  {{
                    profileStackMode === "members"
                      ? t("pages.teams.memberCount", {
                          count: headerCount,
                        })
                      : t("pages.profile.teamCount", {
                          count: headerCount,
                        })
                  }}
                </span>
                <div class="flex items-center gap-1">
                  <TooltipProvider>
                    <div class="flex items-center gap-1">
                      <div class="flex -space-x-1">
                        <Tooltip
                          v-for="avatar in visibleHeaderAvatars"
                          :key="avatar.id"
                        >
                          <TooltipTrigger as-child>
                            <AppAvatar
                              class="ring-background size-4 ring-2"
                              :src="avatar.photoURL"
                              :name="avatar.name || avatar.id"
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            {{ avatar.name || avatar.id }}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <Tooltip v-if="hiddenHeaderAvatarCount > 0">
                        <TooltipTrigger as-child>
                          <AppAvatar class="ring-background size-4 ring-2">
                            <template #fallback>
                              +{{ hiddenHeaderAvatarCount }}
                            </template>
                          </AppAvatar>
                        </TooltipTrigger>
                        <TooltipContent class="max-w-56 text-xs">
                          {{ hiddenHeaderAvatarNames.join(", ") }}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </TooltipProvider>
                </div>
              </div>
            </div>
          </div>
          <div
            class="bg-background mx-auto -mt-10 rounded-4xl border p-1.5 shadow-xs"
          >
            <div v-if="user || team">
              <AppAvatar
                class="size-20"
                :src="user?.photoURL || team?.photoURL"
                :name="user?.displayName || team?.name"
              />
            </div>
            <div
              v-else
              class="bg-muted text-muted-foreground flex size-20 items-center justify-center"
            >
              <IconLock />
            </div>
          </div>
        </div>

        <div
          class="mx-auto flex max-w-2xl flex-col items-center justify-center gap-2 p-4"
        >
          <h1 class="text-2xl font-bold tracking-tight">
            {{ displayName }}
          </h1>

          <span v-if="shouldShowUsername" class="text-muted-foreground">
            <IconAtSign />
            {{ username }}
          </span>
          <p
            v-else-if="isPrivate"
            class="text-muted-foreground text-center text-sm"
          >
            {{ t("pages.publicProfile.privateDescription") }}
          </p>
        </div>

        <div class="flex flex-col items-center justify-center p-2">
          <div
            class="bg-background flex w-full grow rounded-4xl border p-4 shadow-xs"
          >
            Content
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
