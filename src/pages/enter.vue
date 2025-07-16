<script setup lang="ts">
import { authenticateEmail } from "@/modules/auth"

definePage({
  meta: {
    requiresGuest: true,
  },
})

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
  <OverlayScrollbarsWrapper>
    <div
      v-if="authenticateInProgress"
      class="grid size-full grow place-items-center"
    >
      <div class="mx-auto flex flex-col justify-center">
        <icon-lucide-loader class="animate-spin" />
      </div>
    </div>
    <div
      v-else-if="authenticateError"
      class="grid size-full grow place-items-center"
    >
      <div
        class="mx-auto flex w-full max-w-sm flex-col justify-center gap-4 p-6"
      >
        <pre>
        {{ authenticateError }}
        </pre>
        <Button variant="link" class="gap-1" as-child>
          <RouterLink to="/">
            <icon-lucide-chevron-left /> Back to Home
          </RouterLink>
        </Button>
      </div>
    </div>
    <div v-else class="grid size-full grow place-items-center">
      <div
        class="mx-auto flex w-full max-w-sm flex-col justify-center gap-4 p-6"
      >
        <EnterContent />
        <div class="mb-safe-bottom mt-auto flex flex-col gap-2">
          <EnterFooter />
        </div>
      </div>
    </div>
  </OverlayScrollbarsWrapper>
</template>
