<script lang="ts" setup>
import { resumeSessionWatcher } from "@/composables/useDeviceSessions"
import { useGlobalHotkeys } from "@/composables/useGlobalHotkeys"
import { useCurrentUser } from "vuefire"

const user = useCurrentUser()
const router = useRouter()
const route = useRoute()

// Register all global application hotkeys for the app's lifetime.
useGlobalHotkeys()

// Only handle redirecting logged-in users away from guest-only pages.
// Logout redirects are NOT handled here - the router beforeEach guard
// handles protecting routes that require authentication.
watch(
  user,
  async (currentUser, oldUser) => {
    // Resume session watcher on page load for already-authenticated users
    if (currentUser && !oldUser) {
      resumeSessionWatcher(currentUser.uid)
    }

    // Handle authenticated user landing on guest-only routes (e.g., /enter)
    if (currentUser && route.meta.requiresGuest === true) {
      const redirect =
        typeof route.query?.redirect === "string"
          ? route.query.redirect
          : "/start"
      await router.push(redirect)
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="flex size-full">
    <RouterView />
    <Actions />
  </div>
</template>
