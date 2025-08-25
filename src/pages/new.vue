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
  <Teleport defer to="#left-sidebar">
    <Sidebar collapsible="none" class="w-full"></Sidebar>
  </Teleport>
  <EmptyTab />
  <Teleport defer to="#right-sidebar">
    <Sidebar collapsible="none" class="w-full"></Sidebar>
  </Teleport>
</template>
