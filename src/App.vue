<script lang="ts" setup>
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
    const redirect =
      typeof route.query?.redirect === "string" ? route.query.redirect : "/home"
    console.log(`redirecting to ${redirect}`, router)
    return await router.push(redirect)
  }
})
</script>

<template>
  <div class="flex size-full">
    <RouterView />
    <Actions />
  </div>
</template>
