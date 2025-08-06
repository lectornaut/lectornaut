<script setup lang="ts">
definePage({
  meta: {
    requiresUser: true,
    sidebar: "Explore",
    breadcrumb: "Explore",
  },
})

useHead({
  title: "Explore",
})
</script>

<template>
  <HyperApp />
</template>
