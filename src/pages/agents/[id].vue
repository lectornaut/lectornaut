<script setup lang="ts">
definePage({
  meta: {
    layout: "agents",
    requiresUser: true,
    sidebar: "Agent",
    breadcrumb: (route: { params: { id: string } }) =>
      `Agent ${route?.params.id}`,
  },
})

useHead({
  title: "Agent",
})
</script>

<template>
  <div class="flex grow flex-col overflow-auto overscroll-none">
    <div class="flex grow flex-col gap-2">
      <FlowApp />
    </div>
  </div>
</template>
