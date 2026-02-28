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

const loading = ref(true)
const user = ref<DocumentData | null>(null)
const team = ref<DocumentData | null>(null)
const viewedTeamId = ref<string | null>(null)
const entityType = ref<"user" | "team" | null>(null)
const isPrivate = ref(false)
const error = ref<string | null>(null)
const hasFetched = ref(false)

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
    return entityType.value === "team" ? "Private Team" : "Private User"
  }
  return username.value
})

const isPublicProfile = computed(
  () => user.value?.isPublic || team.value?.isPublic || false
)

watch(username, () => {
  hasFetched.value = false
  user.value = null
  team.value = null
  viewedTeamId.value = null
  entityType.value = null
  isPrivate.value = false
  error.value = null
})

const fetchPublicProfile = async () => {
  // Don't fetch if username is empty or already fetched
  if (!username.value || hasFetched.value) return

  hasFetched.value = true
  loading.value = true

  try {
    const result: UserFetchResult = await getUserByUsername(username.value)

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
              return
            case "error":
              error.value = teamResult.message
              break
          }
        }
        break
      case "error":
        error.value = result.message
        break
    }
  } catch (err) {
    console.error("Error fetching user:", err)
    error.value = "An error occurred while fetching the profile"
  } finally {
    loading.value = false
  }
}

// Watch for username and auth state - only fetch after auth has loaded
// This ensures auth.currentUser is available for private profile checks
watch(
  [username, isAuthLoaded],
  ([newUsername, authLoaded]) => {
    if (newUsername && authLoaded && !hasFetched.value) {
      fetchPublicProfile()
    }
  },
  { immediate: true }
)

useHead({
  title: username.value ? `@${username.value}` : "Profile",
})
</script>

<template>
  <div class="container mx-auto">
    <!-- Loading State -->
    <template v-if="loading">
      <div class="flex flex-col items-center justify-center p-2">
        <Spinner />
      </div>
    </template>

    <!-- Shared profile header -->
    <template v-else>
      <div class="flex flex-col items-center justify-center p-2">
        <div
          class="aspect-video max-h-40 w-full rounded-md border bg-[repeating-linear-gradient(45deg,var(--muted)_0,var(--muted)_1px,transparent_0,transparent_50%)] bg-size-[8px_8px]"
        ></div>
        <div class="bg-background mx-auto -mt-10 rounded border p-1">
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

        <span v-if="!error" class="text-muted-foreground">
          <IconAtSign />
          {{ username }}
        </span>

        <div v-if="!error" class="flex items-center gap-2">
          <Badge variant="secondary">
            <IconGlobe v-if="isPublicProfile" />
            <IconLock v-else />
            {{ isPublicProfile ? "Public" : "Private" }} {{ entityType }}
          </Badge>
          <Badge
            v-if="settingsRoute"
            variant="outline"
            @click="router.push(settingsRoute)"
          >
            <IconSettings />
            Settings
          </Badge>
        </div>
        <p v-if="error" class="text-muted-foreground text-sm">{{ error }}</p>
      </div>
    </template>
  </div>
</template>
