<route lang="json">
{
  "meta": {
    "layout": "app",
    "requiresUser": true,
    "title": "Tasks"
  }
}
</route>

<script setup lang="ts">
import { columns } from "@/components/table/columns"
import tasks from "@/data/tasks.json"

useHead({
  title: "Tasks",
})
</script>

<template>
  <div class="flex grow flex-col overflow-auto overscroll-none">
    <DataTable :data="tasks" :columns="columns" />
  </div>
</template>
