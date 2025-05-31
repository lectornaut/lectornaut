<route lang="json">
{
  "meta": {
    "layout": "app",
    "requiresUser": true,
    "title": "Runs"
  }
}
</route>

<script setup lang="ts">
useHead({
  title: "Runs",
})
</script>

<template>
  <div class="flex grow flex-col overflow-auto overscroll-none">
    <div class="flex grow items-center justify-center">Runs</div>
  </div>
</template>
