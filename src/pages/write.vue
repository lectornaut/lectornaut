<script setup lang="ts">
definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Write",
    breadcrumb: "Write",
  },
})

useHead({
  title: "Write",
})
</script>

<template>
  <Editor />
</template>
