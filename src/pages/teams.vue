<script lang="ts" setup>
definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Teams",
    breadcrumb: "Teams",
  },
})

useHead({
  title: "Teams",
})
</script>

<template>
  <Teleport defer to="#left-sidebar">
    <Sidebar collapsible="none" class="w-full"></Sidebar>
  </Teleport>
  <div class="flex grow flex-col overflow-auto overscroll-none scroll-smooth">
    <CodeEditor />
  </div>
  <Teleport defer to="#right-sidebar">
    <Sidebar collapsible="none" class="w-full"></Sidebar>
  </Teleport>
</template>
