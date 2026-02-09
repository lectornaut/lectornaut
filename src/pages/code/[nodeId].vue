<script lang="ts" setup>
import { useNodeBreadcrumb } from "@/composables/useNodeBreadcrumb"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Code",
    breadcrumb: (route: { params?: { nodeId?: unknown } }) =>
      useNodeBreadcrumb("Code", "code")(route),
  },
})
</script>

<template>
  <Code />
</template>
