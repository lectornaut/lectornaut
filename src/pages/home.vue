<script setup lang="ts">
useHead({
  title: "Home",
})
</script>

<template>
  <div class="no-scrollbar flex grow flex-col overflow-auto overscroll-none">
    <div class="flex grow flex-col gap-2 p-2">Home</div>
  </div>
</template>

<route lang="json">
{
  "meta": {
    "layout": "app",
    "requiresUser": true
  }
}
</route>
