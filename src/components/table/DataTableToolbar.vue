<script lang="ts" setup generic="TData extends RowData">
import type { AppTableFeatures } from "@/components/table/features"
import type { RowData, Table } from "@tanstack/vue-table"

const props = withDefaults(
  defineProps<{
    table: Table<AppTableFeatures, TData>
    showSearch?: boolean
    showFilters?: boolean
    showGrouping?: boolean
    showSorting?: boolean
    showViewOptions?: boolean
  }>(),
  {
    showSearch: true,
    showFilters: true,
    showGrouping: true,
    showSorting: true,
    showViewOptions: true,
  }
)
</script>

<template>
  <div
    class="flex shrink-0 items-center justify-between gap-2 overflow-x-auto p-2"
  >
    <div class="flex shrink-0 items-center gap-2">
      <DataTableSearchOptions v-if="props.showSearch" :table="table" />
      <DataTableFilterOptions v-if="props.showFilters" :table="table" />
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <DataTableGroupOptions v-if="props.showGrouping" :table="table" />
      <DataTableSortOptions v-if="props.showSorting" :table="table" />
      <DataTableViewOptions v-if="props.showViewOptions" :table="table" />
    </div>
  </div>
</template>
