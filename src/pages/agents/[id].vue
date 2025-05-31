<route lang="json">
{
  "meta": {
    "layout": "agents",
    "requiresUser": true
  }
}
</route>

<script setup lang="ts">
useHead({
  title: "ID",
})
</script>

<template>
  <div class="flex grow flex-col overflow-auto overscroll-none">
    <div class="flex grow flex-col gap-2">
      <FlowApp />
    </div>
  </div>
</template>
