<script setup lang="ts">
import { columns } from "@/components/table/columns"
import runs from "@/data/runs.json"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Runs",
    breadcrumb: "Runs",
  },
})

useHead({
  title: "Runs",
})
</script>

<template>
  <div class="flex grow flex-col overflow-auto overscroll-none">
    <DataTable :data="runs" :columns="columns" />
  </div>
</template>
