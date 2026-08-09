<script lang="ts" setup generic="TData extends RowData">
import type { AppTableFeatures } from "@/components/table/features"
import { IconCircleX } from "@/data/icons"
import type { Column, RowData, Table } from "@tanstack/vue-table"
import type { Component } from "vue"
import { computed } from "vue"

interface FacetedOption {
  label: string
  value: string
  icon?: Component
}

interface FacetedFilterMeta {
  filterTitle?: string
  filterOptions?: FacetedOption[]
  filterType?: "faceted" | "dateRange"
}

type FilterDescriptor =
  | {
      column: Column<AppTableFeatures, TData, unknown>
      title: string
      type: "dateRange"
    }
  | {
      column: Column<AppTableFeatures, TData, unknown>
      title: string
      type: "faceted"
      options: FacetedOption[]
    }

const props = defineProps<{
  table: Table<AppTableFeatures, TData>
}>()

const isFiltered = computed(
  () => props.table.atoms.columnFilters.get().length > 0
)

const filterableColumns = computed<FilterDescriptor[]>(() => {
  const filters: FilterDescriptor[] = []

  props.table.getAllColumns().forEach((column) => {
    const meta = column.columnDef.meta as FacetedFilterMeta | undefined

    if (meta?.filterType === "dateRange") {
      filters.push({
        column,
        title: meta.filterTitle ?? column.id,
        type: "dateRange",
      })
      return
    }

    if (!meta?.filterOptions || meta.filterOptions.length === 0) {
      return
    }

    filters.push({
      column,
      title: meta.filterTitle ?? column.id,
      type: "faceted",
      options: meta.filterOptions,
    })
  })

  return filters
})
</script>

<template>
  <template
    v-for="filter in filterableColumns"
    :key="`${filter.column.id}-${filter.type}`"
  >
    <DataTableDateRangeFilter
      v-if="filter.type === 'dateRange'"
      :column="filter.column"
      :title="filter.title"
    />
    <DataTableFacetedFilter
      v-else
      :column="filter.column"
      :title="filter.title"
      :options="filter.options"
    />
  </template>
  <Button
    v-if="isFiltered"
    variant="ghost"
    @click="props.table.resetColumnFilters()"
  >
    <IconCircleX />
    Clear
  </Button>
</template>
