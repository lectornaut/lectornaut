<route lang="json">
{
  "meta": {
    "layout": "app",
    "requiresUser": true,
    "title": "Create"
  }
}
</route>

<script setup lang="ts">
useHead({
  title: "Create",
})
</script>

<template>
  <div class="flex grow flex-col overflow-auto overscroll-none">
    <div
      class="flex grow flex-col overflow-auto overscroll-none border border-red-500 p-2"
    >
      <div class="m-2 h-[1800px] w-full border border-green-500"></div>
    </div>
  </div>
</template>
