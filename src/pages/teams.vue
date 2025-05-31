<route lang="json">
{
  "meta": {
    "layout": "app",
    "requiresUser": true,
    "title": "Teams"
  }
}
</route>

<script setup lang="ts">
useHead({
  title: "Teams",
})
</script>

<template>
  <div class="flex grow flex-col overflow-auto overscroll-none">
    <div class="flex grow items-center justify-center">Teams</div>
  </div>
</template>
