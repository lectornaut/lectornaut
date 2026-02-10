<script lang="ts" setup>
import { IconAtSign, IconGlobe, IconLock, IconSettings } from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import { getUserByUsername, type UserFetchResult } from "@/queries/username"
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

const isCurrentUser = computed(
  () => currentUserData.value?.username === username.value
)

const loading = ref(true)
const user = ref<DocumentData | null>(null)
const isPrivate = ref(false)
const error = ref<string | null>(null)
const hasFetched = ref(false)

const fetchUserProfile = async () => {
  // Don't fetch if username is empty or already fetched
  if (!username.value || hasFetched.value) return

  hasFetched.value = true
  loading.value = true

  try {
    const result: UserFetchResult = await getUserByUsername(username.value)

    switch (result.status) {
      case "found":
        user.value = result.data
        break
      case "private":
        isPrivate.value = true
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
      fetchUserProfile()
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
        <div class="bg-background mx-auto -mt-10 rounded-full border p-1">
          <div v-if="user">
            <Avatar class="size-20 rounded-full">
              <AvatarImage
                class="size-20 rounded-full"
                :src="user?.photoURL!"
                :alt="user?.displayName"
                referrerpolicy="no-referrer"
              />
              <AvatarFallback class="size-20 rounded-full">
                {{ getInitials(user.displayName) }}
              </AvatarFallback>
            </Avatar>
          </div>
          <div
            v-else
            class="bg-muted text-muted-foreground flex size-20 items-center justify-center rounded-full"
          >
            <IconLock />
          </div>
        </div>
      </div>

      <div
        class="mx-auto flex max-w-2xl flex-col items-center justify-center gap-2 p-4"
      >
        <h1 class="text-2xl font-bold tracking-tight">
          {{ user ? user.displayName : isPrivate ? "Private User" : username }}
        </h1>

        <span v-if="!error" class="text-muted-foreground">
          <IconAtSign />
          {{ username }}
        </span>

        <div v-if="!error" class="flex items-center gap-2">
          <Badge variant="secondary">
            <IconGlobe v-if="user?.isPublic" />
            <IconLock v-else />
            {{ user?.isPublic ? "Public" : "Private" }}
          </Badge>

          <Badge
            v-if="isCurrentUser"
            variant="outline"
            @click="router.push('/profile')"
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
