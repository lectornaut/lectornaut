<script lang="ts" setup>
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
    router.push("/start")
  } else {
    router.push("/enter")
  }
})
</script>

<template>
  <div
    class="before:from-background fixed inset-x-0 bottom-0 z-20 flex flex-col items-center justify-center gap-6 p-4 before:absolute before:inset-0 before:bg-linear-to-t before:backdrop-blur-lg before:[mask:linear-gradient(transparent,black_95%)]"
  >
    <div
      class="bg-background/5 flex items-center gap-1.5 rounded-xl border p-1.5 shadow-xl backdrop-blur-lg"
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              v-if="!isUserLoaded"
              variant="ghost"
              size="icon-sm"
              disabled
            >
              <Spinner />
            </Button>
            <Button v-else-if="user" as-child variant="outline" size="sm">
              <RouterLink to="/start">
                {{ t("landing.cta.enter") }}
              </RouterLink>
            </Button>
            <EnterTrigger v-else>
              <Button variant="outline" size="sm">
                {{ t("landing.cta.enter") }}
              </Button>
            </EnterTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">
            Press <Kbd>↩</Kbd> to login or sign up
          </TooltipContent>
        </Tooltip>
        <Faq />
      </TooltipProvider>
    </div>
    <div class="mb-safe-bottom text-muted-foreground z-10 text-center">
      {{ t("hello") }}, {{ t("landing.cta.description") }}
    </div>
  </div>
</template>
