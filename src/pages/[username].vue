<script lang="ts" setup>
import { IconChevronLeft, IconLock } from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import { getUserByUsername, type UserFetchResult } from "@/queries/username"
import type { DocumentData } from "firebase/firestore"
import { useRoute, useRouter } from "vue-router"
import { useIsCurrentUserLoaded } from "vuefire"

const route = useRoute()
const router = useRouter()
const isAuthLoaded = useIsCurrentUserLoaded()

const username = computed(() => {
  const name = (route.params as { username?: string }).username || ""
  return name && name.startsWith("@") ? name.slice(1) : name
})

const loading = ref(true)
const user = ref<DocumentData | null>(null)
const isPrivate = ref(false)
const privateDisplayName = ref<string | undefined>(undefined)
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
        privateDisplayName.value = result.displayName
        break
      case "not_found":
        // Redirect to 404 page - let [...path].vue handle it
        router.replace(`/${username.value}/not-found`)
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
  <div class="mx-auto max-w-2xl p-6">
    <div
      v-if="loading"
      class="flex min-h-[50vh] flex-col items-center justify-center space-y-4"
    >
      <Spinner class="size-8" />
      <p class="text-muted-foreground animate-pulse">Fetching profile...</p>
    </div>
    <div
      v-else-if="isPrivate"
      class="flex min-h-[50vh] flex-col items-center justify-center space-y-6 text-center"
    >
      <div
        class="bg-muted text-muted-foreground flex size-20 items-center justify-center rounded-full"
      >
        <IconLock class="size-10" />
      </div>
      <div class="space-y-2">
        <h2 class="text-primary text-2xl font-bold italic">@{{ username }}</h2>
        <p class="text-muted-foreground mx-auto max-w-xs">
          This profile is private
        </p>
      </div>
      <Button variant="outline" as-child>
        <RouterLink to="/">
          <IconChevronLeft class="mr-2 size-4" />
          Back to Home
        </RouterLink>
      </Button>
    </div>
    <div
      v-else-if="error"
      class="flex min-h-[50vh] flex-col items-center justify-center space-y-6 text-center"
    >
      <div
        class="bg-muted text-muted-foreground flex size-20 items-center justify-center rounded-full"
      >
        <IconLock class="size-10" />
      </div>
      <div class="space-y-2">
        <h2 class="text-primary text-2xl font-bold italic">@{{ username }}</h2>
        <p class="text-muted-foreground mx-auto max-w-xs">
          {{ error }}
        </p>
      </div>
      <Button variant="outline" as-child>
        <RouterLink to="/">
          <IconChevronLeft class="mr-2 size-4" />
          Back to Home
        </RouterLink>
      </Button>
    </div>
    <div
      v-else-if="user"
      class="animate-in fade-in slide-in-from-bottom-4 space-y-8 duration-500"
    >
      <div class="flex flex-col items-center space-y-4 text-center">
        <Avatar class="border-accent size-32 rounded-full border-4 shadow-2xl">
          <AvatarImage :src="user.photoURL" :alt="user.displayName" />
          <AvatarFallback class="text-3xl font-bold">{{
            getInitials(user.displayName)
          }}</AvatarFallback>
        </Avatar>
        <div class="space-y-1">
          <h1 class="text-4xl font-bold tracking-tight">
            {{ user.displayName }}
          </h1>
          <p class="text-primary font-mono text-xl">@{{ user.username }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
