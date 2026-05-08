<script lang="ts" setup>
definePage({
  meta: {
    requiresUser: true,
    layout: "app",
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
