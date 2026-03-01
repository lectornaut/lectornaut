<script lang="ts" setup>
import { useTeamActions } from "@/composables/useTeamActions"
import { IconAtSign, IconGlobe, IconLock, IconSettings } from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import {
  getTeamByUsername,
  getUserByUsername,
  type TeamFetchResult,
  type UserFetchResult,
} from "@/queries/username"
import type { DocumentData } from "firebase/firestore"
import { doc } from "firebase/firestore"
import { useRoute, useRouter } from "vue-router"
import {
  useCurrentUser,
  useDocument,
  useFirestore,
  useIsCurrentUserLoaded,
} from "vuefire"

const route = useRoute()
const router = useRouter()
const isAuthLoaded = useIsCurrentUserLoaded()
const { t } = useI18n()

const currentUser = useCurrentUser()
const db = useFirestore()
const currentUserRef = computed(() =>
  currentUser.value ? doc(db, "users", currentUser.value.uid) : null
)
const { data: currentUserData } = useDocument(currentUserRef)

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
let fetchRequestId = 0

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

  return currentUserData.value?.username === username.value
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

watch(username, () => {
  user.value = null
  team.value = null
  viewedTeamId.value = null
  entityType.value = null
  isPrivate.value = false
  error.value = null
  loading.value = !!username.value
})

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
  <div class="container mx-auto">
    <!-- Loading State -->
    <template v-if="loading">
      <div class="flex h-screen flex-col items-center justify-center p-2">
        <Spinner />
      </div>
    </template>

    <!-- Shared profile header -->
    <template v-else>
      <div class="flex flex-col items-center justify-center p-2">
        <div
          class="bg-background flex aspect-video max-h-40 w-full flex-col rounded-lg border bg-[repeating-linear-gradient(135deg,var(--border)_0,var(--border)_1px,transparent_0,transparent_25%)] bg-size-[16px_16px] shadow-xs"
        >
          <div class="flex items-center justify-between p-2">
            <Logo class="size-8 shrink-0 p-2" />
            <Button
              v-if="settingsRoute"
              variant="outline"
              size="sm"
              @click="router.push(settingsRoute)"
            >
              <IconSettings />
              {{ t("pages.publicProfile.settings") }}
            </Button>
          </div>
          <div class="flex grow items-center justify-between p-2"></div>
          <div class="flex items-center justify-between p-2">
            avatar stack here
          </div>
        </div>
        <div
          class="bg-background mx-auto -mt-10 rounded-lg border p-1.5 shadow-xs"
        >
          <div v-if="user || team">
            <Avatar class="size-20 rounded">
              <AvatarImage
                class="size-20 rounded"
                :src="(user?.photoURL || team?.photoURL) ?? ''"
                :alt="user?.displayName || team?.name"
                referrerpolicy="no-referrer"
              />
              <AvatarFallback class="size-20 rounded">
                {{ getInitials(user?.displayName || team?.name) }}
              </AvatarFallback>
            </Avatar>
          </div>
          <div
            v-else
            class="bg-muted text-muted-foreground flex size-20 items-center justify-center rounded"
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

        <div v-if="error" class="flex flex-col items-center gap-2">
          <p class="text-muted-foreground text-sm">{{ error }}</p>
          <Button variant="outline" size="sm" @click="fetchPublicProfile">
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
      </div>
    </template>
  </div>
</template>
