<script lang="ts" setup>
import DataTableFacetedFilter from "./DataTableFacetedFilter.vue"
import DataTableViewOptions from "./DataTableViewOptions.vue"
import { priorities, statuses } from "@/data/data"
import type { Task } from "@/data/schema"
import type { Table } from "@tanstack/vue-table"

interface DataTableToolbarProps {
  table: Table<Task>
}

const props = defineProps<DataTableToolbarProps>()

const isFiltered = computed(
  () => props.table.getState().columnFilters.length > 0
)
</script>

<template>
  <div class="flex items-center justify-between gap-2">
    <div class="flex items-center space-x-2">
      <Input
        placeholder="Filter tasks..."
        :model-value="
          (table.getColumn('title')?.getFilterValue() as string) ?? ''
        "
        class="h-9 focus:border-inherit focus:ring-0"
        @input="table.getColumn('title')?.setFilterValue($event.target.value)"
      />
      <DataTableFacetedFilter
        v-if="table.getColumn('status')"
        :column="table.getColumn('status')"
        title="Status"
        :options="statuses"
      />
      <DataTableFacetedFilter
        v-if="table.getColumn('priority')"
        :column="table.getColumn('priority')"
        title="Priority"
        :options="priorities"
      />
      <Button
        v-if="isFiltered"
        variant="secondary"
        size="sm"
        @click="table.resetColumnFilters()"
      >
        Reset filters
      </Button>
    </div>
    <DataTableViewOptions :table="table" />
  </div>
</template>
