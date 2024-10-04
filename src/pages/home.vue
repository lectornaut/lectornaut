<script setup lang="ts">
useHead({
  title: "Home",
})
</script>

<template>
  <div class="no-scrollbar flex max-h-fit overflow-y-auto p-2">
    <div class="grid grow gap-2">
      <div class="flex items-center justify-between gap-2">
        <DateViewPicker />
        <div class="flex items-center gap-2">
          <NewTransaction />
        </div>
      </div>
      <Insights />
    </div>
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
