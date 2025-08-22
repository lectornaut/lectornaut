<script setup lang="ts">
definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "New tab",
    breadcrumb: "New tab",
  },
})

useHead({
  title: "New tab",
})
</script>

<template>
  <EmptyTab />
</template>
