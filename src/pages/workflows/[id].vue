<route lang="json">
{
  "meta": {
    "layout": "workflows",
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
  <div class="no-scrollbar flex grow flex-col overflow-auto overscroll-none">
    <div class="flex grow flex-col gap-2">
      <FlowApp />
    </div>
  </div>
</template>
