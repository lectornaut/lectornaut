<script setup lang="ts">
import { authenticateEmail } from "@/modules/auth"

useHead({
  title: "Enter",
})

const authenticateInProgress = ref(true)
const authenticateError = ref(false)

onMounted(async () => {
  authenticateInProgress.value = true
  authenticateError.value = false

  await authenticateEmail()
    .then(() => {
      authenticateInProgress.value = true
    })
    .catch((error) => {
      authenticateError.value = error
    })
    .finally(() => {
      authenticateInProgress.value = false
    })
})
</script>

<template>
  <div v-if="authenticateInProgress" class="flex grow place-items-center">
    <div class="mx-auto">
      <icon-lucide-loader class="animate-spin" />
    </div>
  </div>
  <div v-else-if="authenticateError" class="flex grow place-items-center">
    <div class="mx-auto flex flex-col items-center">
      {{ authenticateError }}
      <Button variant="link" class="gap-1" as-child>
        <RouterLink to="/enter">
          <icon-lucide-chevron-left /> Back to Home
        </RouterLink>
      </Button>
    </div>
  </div>
  <div v-else class="flex grow place-items-center">
    <div class="mx-auto flex w-full max-w-sm flex-col">
      <div class="sr-only grid gap-1.5 p-4 text-center sm:text-left">
        <h1 class="text-lg leading-none font-semibold tracking-tight">
          Enter Template
        </h1>
        <p class="text-muted-foreground">
          Create an account or sign in to continue.
        </p>
      </div>
      <EnterContent />
      <div class="mb-safe-bottom mt-auto flex flex-col gap-2 p-4">
        <EnterFooter />
      </div>
    </div>
  </div>
</template>

<route lang="json">
{
  "meta": {
    "requiresGuest": true
  }
}
</route>
