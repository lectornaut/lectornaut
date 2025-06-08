<script setup lang="ts">
import type { Task } from "@/data/schema"
import type { Table } from "@tanstack/vue-table"

interface DataTableViewOptionsProps {
  table: Table<Task>
}

const props = defineProps<DataTableViewOptionsProps>()
</script>

<template>
  <div class="relative">
    <span
      class="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center px-3"
    >
      <icon-lucide-search />
    </span>
    <Input
      placeholder="Search"
      :model-value="
        (props.table.getColumn('title')?.getFilterValue() as string) ?? ''
      "
      class="pl-9"
      @input="
        props.table.getColumn('title')?.setFilterValue($event.target.value)
      "
    />
  </div>
</template>
