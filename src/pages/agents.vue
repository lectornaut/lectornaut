<script setup lang="ts">
definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Agents",
    breadcrumb: "Agents",
  },
})

useHead({
  title: "Agents",
})
</script>

<template>
  <RouterView />
</template>
