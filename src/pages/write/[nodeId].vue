<script lang="ts" setup>
import { useNodeBreadcrumb } from "@/composables/useNodeBreadcrumb"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Write",
    breadcrumb: (route: { params?: { nodeId?: unknown } }) =>
      useNodeBreadcrumb("Write", "write")(route),
  },
})
</script>

<template>
  <Write />
</template>
