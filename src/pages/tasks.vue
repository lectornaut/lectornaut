<route lang="json">
{
  "meta": {
    "layout": "app",
    "requiresUser": true,
    "title": "Tasks"
  }
}
</route>

<script setup lang="ts">
useHead({
  title: "Tasks",
})
</script>

<template>
  <div class="flex grow flex-col overflow-auto overscroll-none">
    <div class="flex grow items-center justify-center">Tasks</div>
  </div>
</template>
