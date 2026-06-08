<script lang="ts" setup>
import { IconCheckCircle } from "@/data/icons"

const { t } = useI18n()

definePage({
  // Transient redirect page — no chrome.
  meta: {
    layout: false,
  },
})

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
          <EmptyTitle>{{ t("pages.deeplink.continueTitle") }}</EmptyTitle>
          <EmptyDescription>
            {{ t("pages.deeplink.continueDescription") }}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
      <LoadingState v-else />
    </div>
  </OverlayScrollbarsWrapper>
</template>
