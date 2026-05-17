<script lang="ts" setup>
defineProps<{
  placeholder?: string
}>()
</script>

<template>
  <OverlayScrollbarsWrapper>
    <AiChat />
    <AiChatComposer :placeholder="placeholder" />
  </OverlayScrollbarsWrapper>
</template>
