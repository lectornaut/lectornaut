<script lang="ts" setup>
defineProps<{
  placeholder?: string
}>()
</script>

<template>
  <div class="flex size-full min-h-0 min-w-0 grow flex-col overflow-hidden">
    <AiChat />
    <AiChatComposer :placeholder="placeholder" />
  </div>
</template>
