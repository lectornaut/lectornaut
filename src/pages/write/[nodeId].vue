<script lang="ts" setup>
import { useNodeBreadcrumb } from "@/composables/useNodeBreadcrumb"

const breadcrumb = useNodeBreadcrumb("Write", "write")

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Write",
    breadcrumb,
  },
})
</script>

<template>
  <Write />
</template>
