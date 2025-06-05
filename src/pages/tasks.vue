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
import { columns } from "@/components/tasks/columns"
import tasks from "@/data/tasks.json"

useHead({
  title: "Tasks",
})
</script>

<template>
  <div class="flex flex-col overflow-auto overscroll-none">
    <DataTable :data="tasks" :columns="columns" />
  </div>
</template>
