<route lang="json">
{
  "meta": {
    "layout": false,
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
  <div class="flex grow items-center justify-center">
    Select a workflow to view its details.
  </div>
</template>
