<script setup lang="ts">
import { priorities, statuses } from "@/data/constants"
import type { Task } from "@/data/schema"
import type { Table } from "@tanstack/vue-table"

interface DataTableViewOptionsProps {
  table: Table<Task>
}

const props = defineProps<DataTableViewOptionsProps>()

const isFiltered = computed(
  () => props.table.getState().columnFilters.length > 0
)
</script>

<template>
  <DataTableFacetedFilter
    v-if="props.table.getColumn('status')"
    :column="props.table.getColumn('status')"
    title="Status"
    :options="statuses"
  />
  <DataTableFacetedFilter
    v-if="props.table.getColumn('priority')"
    :column="props.table.getColumn('priority')"
    title="Priority"
    :options="priorities"
  />
  <Button
    v-if="isFiltered"
    variant="ghost"
    @click="props.table.resetColumnFilters()"
  >
    <icon-lucide-circle-x />
    Clear
  </Button>
</template>
