<script setup lang="ts">
import hotkeys from "hotkeys-js"
import { useCurrentUser, useIsCurrentUserLoaded } from "vuefire"

const { t } = useI18n()
const router = useRouter()
const user = useCurrentUser()
const isUserLoaded = useIsCurrentUserLoaded()

hotkeys("enter", (event) => {
  console.log("Enter key pressed")
  event.preventDefault()
  if (user.value) {
    router.push("/home")
  } else {
    router.push("/enter")
  }
})
</script>

<template>
  <div
    class="before:from-background fixed inset-x-0 bottom-0 z-20 flex flex-col items-center justify-center gap-6 p-4 before:absolute before:inset-0 before:bg-linear-to-t before:backdrop-blur-lg before:[mask:linear-gradient(transparent,_black_95%)]"
  >
    <div
      class="bg-background/5 flex items-center gap-1.5 rounded-full border p-1.5 shadow-xl backdrop-blur-lg"
    >
      <Button v-if="!isUserLoaded" variant="ghost" size="icon" disabled>
        <icon-lucide-loader class="animate-spin" />
      </Button>
      <Button v-else-if="user" as-child>
        <RouterLink to="/home"> Enter </RouterLink>
      </Button>
      <EnterTrigger v-else>
        <Button> Enter </Button>
      </EnterTrigger>
      <Faq />
    </div>
    <div class="mb-safe-bottom text-muted-foreground z-10 text-center">
      {{ t("hello") }}, track expenses, set goals, and save money.
    </div>
  </div>
</template>
