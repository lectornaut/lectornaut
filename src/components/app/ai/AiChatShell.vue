<script lang="ts" setup>
defineProps<{
  placeholder?: string
  usageLabel?: string
}>()
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col">
    <div class="min-h-0 flex-1">
      <AiChat />
    </div>
    <div class="rounded-lg rounded-b-none p-2 pt-0">
      <AiChatComposer :placeholder="placeholder" :usage-label="usageLabel" />
    </div>
  </div>
</template>
