<script lang="ts" setup>
import { IconChevronLeft } from "@/data/icons"
import { authenticateEmail } from "@/modules/auth"

definePage({
  meta: {
    requiresGuest: true,
  },
})

useHead({
  title: "Enter",
})

const { t } = useI18n()

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
  <OverlayScrollbarsWrapper class="bg-background">
    <div
      v-if="authenticateInProgress"
      class="grid size-full grow place-items-center"
    >
      <div class="mx-auto flex flex-col justify-center">
        <Spinner />
      </div>
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
