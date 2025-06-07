<script setup lang="ts">
import { priorities, statuses } from "@/data/constants"
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
  <div class="flex items-center justify-between gap-2 p-2">
    <div class="flex items-center gap-2">
      <div class="relative">
        <span
          class="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center px-3"
        >
          <icon-lucide-search />
        </span>
        <Input
          placeholder="Search"
          :model-value="
            (table.getColumn('title')?.getFilterValue() as string) ?? ''
          "
          class="pl-9"
          @input="table.getColumn('title')?.setFilterValue($event.target.value)"
        />
      </div>
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
        variant="ghost"
        size="icon"
        @click="table.resetColumnFilters()"
      >
        <icon-lucide-funnel-x />
      </Button>
    </div>
    <DataTableViewOptions :table="table" />
  </div>
</template>
