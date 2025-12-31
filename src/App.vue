<script lang="ts" setup>
import { useCurrentUser } from "vuefire"

const user = useCurrentUser()
const router = useRouter()
const route = useRoute()

// Only handle redirecting logged-in users away from guest-only pages.
// Logout redirects are NOT handled here - the router beforeEach guard
// handles protecting routes that require authentication.
watch(user, async (currentUser) => {
  // Handle authenticated user landing on guest-only routes (e.g., /enter)
  if (currentUser && route.meta.requiresGuest === true) {
    const redirect =
      typeof route.query?.redirect === "string" ? route.query.redirect : "/home"
    console.log(
      `App.vue: User logged in on guest route, redirecting to ${redirect}`
    )
    await router.push(redirect)
  }
})
</script>

<template>
  <div class="flex size-full">
    <RouterView />
    <Actions />
  </div>
</template>
