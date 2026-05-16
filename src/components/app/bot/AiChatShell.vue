<script lang="ts" setup>
defineProps<{
  placeholder?: string
  usageLabel?: string
}>()
</script>

<template>
  <OverlayScrollbarsWrapper>
    <AiChat />
    <AiChatComposer :placeholder="placeholder" :usage-label="usageLabel" />
  </OverlayScrollbarsWrapper>
</template>
