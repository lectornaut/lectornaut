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
  <Teleport defer to="#left-sidebar">
    <Sidebar collapsible="none" class="w-full"></Sidebar>
  </Teleport>
  <Editor />
  <Teleport defer to="#right-sidebar">
    <Sidebar collapsible="none" class="w-full"></Sidebar>
  </Teleport>
</template>
