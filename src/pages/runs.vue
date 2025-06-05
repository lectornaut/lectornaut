<route lang="json">
{
  "meta": {
    "layout": "app",
    "requiresUser": true,
    "title": "Runs"
  }
}
</route>

<script setup lang="ts">
import { columns } from "@/components/tasks/columns"
import runs from "@/data/runs.json"

useHead({
  title: "Runs",
})
</script>

<template>
  <div class="flex flex-col overflow-auto overscroll-none">
    <DataTable :data="runs" :columns="columns" />
  </div>
</template>
