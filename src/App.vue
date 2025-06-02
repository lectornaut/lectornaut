<script setup lang="ts">
import { useCurrentUser } from "vuefire"

const user = useCurrentUser()
const router = useRouter()
const route = useRoute()

watch(user, async (currentUser, previousUser) => {
  if (!currentUser && previousUser && route.meta.requiresUser) {
    console.log("redirecting to /", router)
    return await router.push("/")
  }
  if (currentUser && route.meta.requiresGuest) {
    console.log("redirecting to /home", router)
    return await router.push(
      typeof route.query?.redirect === "string" ? route.query.redirect : "/home"
    )
  }
})
</script>

<template>
  <div class="flex size-full">
    <RouterView />
    <Actions />
  </div>
</template>
