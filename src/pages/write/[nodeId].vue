<script lang="ts" setup>
import { useNodeBreadcrumb } from "@/helpers/breadcrumber"

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
