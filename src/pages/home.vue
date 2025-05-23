<route lang="json">
{
  "meta": {
    "layout": "app",
    "requiresUser": true,
    "title": "Home"
  }
}
</route>

<script setup lang="ts">
useHead({
  title: "Home",
})
</script>

<template>
  <div class="no-scrollbar flex grow flex-col overflow-auto overscroll-none">
    <div class="flex grow flex-col gap-2">
      <FlowApp />
    </div>
  </div>
</template>
