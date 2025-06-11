<script setup lang="ts">
import { columns } from "@/components/table/columns"
import tasks from "@/data/tasks.json"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Tasks",
    breadcrumb: "Tasks",
  },
})

useHead({
  title: "Tasks",
})
</script>

<template>
  <div class="flex grow flex-col overflow-auto overscroll-none">
    <DataTable :data="tasks" :columns="columns" />
  </div>
</template>
