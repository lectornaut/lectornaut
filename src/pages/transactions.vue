<script setup lang="ts">
import { columns } from "@/components/transactions/columns"
import tasks from "@/data/tasks.json"

useHead({
  title: "Transactions",
})
</script>

<template>
  <div class="no-scrollbar flex max-h-fit overflow-y-auto p-2">
    <DataTable :data="tasks" :columns="columns" />
  </div>
</template>

<route lang="json">
{
  "meta": {
    "layout": "app"
  }
}
</route>
<!-- "requiresUser": true -->
