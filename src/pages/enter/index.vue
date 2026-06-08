<script lang="ts" setup>
import { IconChevronLeft } from "@/data/icons"
import {
  authenticateEmail,
  authenticateOAuth,
  handleSsoRedirectResult,
} from "@/modules/auth"
import { useCurrentUser } from "vuefire"

useHead({
  title: "Enter",
})

const { t } = useI18n()
const user = useCurrentUser()
const route = useRoute()
const router = useRouter()

const authenticateInProgress = ref(true)
const authenticateError = ref(false)

// Pre-empt App.vue's requiresGuest watcher so the sign-in form never paints
// for an already-authenticated user (e.g. post-OAuth, bookmarked /enter).
watch(
  user,
  (current) => {
    if (!current) return
    const redirect =
      typeof route.query?.redirect === "string"
        ? route.query.redirect
        : "/start"
    router.replace(redirect)
  },
  { immediate: true }
)

onMounted(async () => {
  authenticateInProgress.value = true
  authenticateError.value = false

  await Promise.all([
    handleSsoRedirectResult(),
    authenticateEmail(),
    authenticateOAuth(),
  ])
    .catch((error) => {
      authenticateError.value = error
    })
    .finally(() => {
      authenticateInProgress.value = false
    })
})
</script>

<template>
  <OverlayScrollbarsWrapper class="bg-background">
    <div
      v-if="user || authenticateInProgress"
      class="grid size-full grow place-items-center"
    >
      <LoadingState />
    </div>
    <div
      v-else-if="authenticateError"
      class="grid size-full grow place-items-center"
    >
      <div
        class="mx-auto flex w-full max-w-sm flex-col justify-center gap-8 p-4"
      >
        <pre>
        {{ authenticateError }}
        </pre>
        <Button variant="link" class="gap-1" as-child>
          <RouterLink to="/">
            <IconChevronLeft /> {{ t("common.backToHome") }}
          </RouterLink>
        </Button>
      </div>
    </div>
    <div v-else class="grid size-full grow place-items-center">
      <div
        class="mx-auto flex w-full max-w-sm flex-col justify-center gap-8 p-4"
      >
        <EnterContent />
        <div class="mb-safe-bottom mx-auto">
          <EnterFooter />
        </div>
      </div>
    </div>
  </OverlayScrollbarsWrapper>
</template>
