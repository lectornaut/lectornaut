<script lang="ts" setup>
onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  const target = params.get("target")

  if (target === "tauri") {
    // Rebuild the full URL with lectornaut:// scheme, forwarding all query params
    params.delete("target")
    const deepLinkUrl = `lectornaut://verify?${params.toString()}`
    window.location.href = deepLinkUrl
  }
})
</script>

<template>
  <OverlayScrollbarsWrapper class="bg-background">
    <div data-tauri-drag-region class="grid size-full grow place-items-center">
      <div class="mx-auto flex flex-col justify-center">
        <Spinner />
      </div>
    </div>
  </OverlayScrollbarsWrapper>
</template>
