<script setup lang="ts">
import type { Task } from "@/data/schema"
import type { Table } from "@tanstack/vue-table"

interface DataTableToolbarProps {
  table: Table<Task>
}

defineProps<DataTableToolbarProps>()
</script>

<template>
  <div class="flex items-center justify-between gap-2 p-2">
    <div class="flex items-center gap-2">
      <DataTableSearchOptions :table="table" />
      <DataTableFilterOptions :table="table" />
    </div>
    <div class="flex items-center gap-2">
      <DataTableGroupOptions :table="table" />
      <DataTableSortOptions :table="table" />
      <DataTableViewOptions :table="table" />
    </div>
  </div>
</template>
