<route lang="json">
{
  "meta": {
    "layout": "app",
    "requiresUser": true,
    "title": "Drafts"
  }
}
</route>

<script setup lang="ts">
useHead({
  title: "Drafts",
})
</script>

<template>
  <div class="no-scrollbar flex grow flex-col overflow-auto overscroll-none">
    <div class="flex grow flex-col gap-2">
      <FlowApp />
    </div>
  </div>
</template>
