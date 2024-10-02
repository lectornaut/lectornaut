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
  <div class="flex min-h-dvh flex-col">
    <RouterView v-slot="{ Component }">
      <template v-if="Component">
        <Transition
          enter-active-class="transition ease-in-out duration-300"
          enter-from-class="opacity-0"
          enter-to-class="opacity-100"
          leave-active-class="transition ease-in-out duration-300"
          leave-from-class="opacity-100"
          leave-to-class="opacity-0"
          mode="out-in"
        >
          <Suspense>
            <Component :is="Component" />
            <template #fallback> Loading... </template>
          </Suspense>
        </Transition>
      </template>
    </RouterView>
    <Actions />
  </div>
</template>
