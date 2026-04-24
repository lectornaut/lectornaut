<script lang="ts" setup>
import { IconCheckCircle } from "@/data/icons"

const redirected = ref(false)

onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  const target = params.get("target")

  if (target === "tauri") {
    // Rebuild the full URL with lectornaut:// scheme, forwarding all query params
    params.delete("target")
    const deepLinkUrl = `lectornaut://verify?${params.toString()}`
    window.location.href = deepLinkUrl
    redirected.value = true
  }
})
</script>

<template>
  <OverlayScrollbarsWrapper class="bg-background">
    <div class="grid size-full grow place-items-center">
      <Empty v-if="redirected">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconCheckCircle />
          </EmptyMedia>
          <EmptyTitle>Continue in Lectornaut</EmptyTitle>
          <EmptyDescription>
            The app should open automatically. You can close this tab.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
      <Empty v-else>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner />
          </EmptyMedia>
        </EmptyHeader>
      </Empty>
    </div>
  </OverlayScrollbarsWrapper>
</template>
