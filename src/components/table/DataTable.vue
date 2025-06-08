<script setup lang="ts">
import type { Task } from "@/data/schema"
import { valueUpdater } from "@/lib/utils"
import type {
  ColumnDef,
  ColumnFiltersState,
  ExpandedState,
  GroupingState,
  SortingState,
  VisibilityState,
} from "@tanstack/vue-table"
import {
  FlexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getGroupedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useVueTable,
} from "@tanstack/vue-table"

interface DataTableProps {
  columns: ColumnDef<Task, unknown>[]
  data: Task[]
}
const props = defineProps<DataTableProps>()

const sorting = ref<SortingState>([])
const columnFilters = ref<ColumnFiltersState>([])
const columnVisibility = ref<VisibilityState>({})
const rowSelection = ref({})
const expanded = ref<ExpandedState>({})
const grouping = ref<GroupingState>([])

const table = useVueTable({
  get data() {
    return props.data
  },
  get columns() {
    return props.columns
  },
  state: {
    get sorting() {
      return sorting.value
    },
    get columnFilters() {
      return columnFilters.value
    },
    get columnVisibility() {
      return columnVisibility.value
    },
    get rowSelection() {
      return rowSelection.value
    },
    get expanded() {
      return expanded.value
    },
    get grouping() {
      return grouping.value
    },
    columnPinning: {
      left: ["select"],
      right: ["actions"],
    },
  },
  enableRowSelection: true,
  onSortingChange: (updaterOrValue) => valueUpdater(updaterOrValue, sorting),
  onColumnFiltersChange: (updaterOrValue) =>
    valueUpdater(updaterOrValue, columnFilters),
  onColumnVisibilityChange: (updaterOrValue) =>
    valueUpdater(updaterOrValue, columnVisibility),
  onRowSelectionChange: (updaterOrValue) =>
    valueUpdater(updaterOrValue, rowSelection),
  onExpandedChange: (updaterOrValue) => valueUpdater(updaterOrValue, expanded),
  onGroupingChange: (updaterOrValue) => valueUpdater(updaterOrValue, grouping),
  getCoreRowModel: getCoreRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
  getPaginationRowModel: getPaginationRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getFacetedRowModel: getFacetedRowModel(),
  getFacetedUniqueValues: getFacetedUniqueValues(),
  getExpandedRowModel: getExpandedRowModel(),
  getGroupedRowModel: getGroupedRowModel(),
})
</script>

<template>
  <DataTableToolbar :table="table" />
  <div
    class="bg-card flex grow flex-col overflow-auto overscroll-none border-y"
  >
    <OverlayScrollbarsWrapper>
      <Table>
        <TableHeader>
          <TableRow
            v-for="headerGroup in table.getHeaderGroups()"
            :key="headerGroup.id"
          >
            <TableHead
              v-for="header in headerGroup.headers"
              :key="header.id"
              :data-pinned="header.column.getIsPinned()"
              :class="[
                {
                  'from-card/50 sticky from-50%': header.column.getIsPinned(),
                },
                header.column.getIsPinned() === 'left'
                  ? 'left-0 bg-gradient-to-r'
                  : 'right-0 bg-gradient-to-l',
              ]"
            >
              <FlexRender
                v-if="!header.isPlaceholder"
                :render="header.column.columnDef.header"
                :props="header.getContext()"
              />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-if="table.getRowModel().rows?.length">
            <template v-for="row in table.getRowModel().rows" :key="row.id">
              <TableRow
                :data-state="row.getIsSelected() && 'selected'"
                :data-expanded="row.getIsExpanded() && 'expanded'"
                :data-grouped="row.getIsGrouped() && 'grouped'"
                :class="[
                  row.getIsSelected() && 'bg-accent',
                  row.getIsExpanded() && 'bg-accent/50',
                ]"
              >
                <TableCell
                  v-for="cell in row.getVisibleCells()"
                  :key="cell.id"
                  :data-pinned="cell.column.getIsPinned()"
                  :class="[
                    {
                      'from-card/50 sticky from-50%': cell.column.getIsPinned(),
                    },
                    cell.column.getIsPinned() === 'left'
                      ? 'left-0 bg-gradient-to-r'
                      : 'right-0 bg-gradient-to-l',
                  ]"
                >
                  <template v-if="cell.getIsGrouped()">
                    <Button
                      variant="link"
                      class="!p-0 text-inherit"
                      @click="row.getToggleExpandedHandler()()"
                    >
                      <FlexRender
                        :render="cell.column.columnDef.cell"
                        :props="cell.getContext()"
                      />
                      <span class="text-muted-foreground">
                        {{ row.subRows.length }}
                      </span>
                      <icon-lucide-chevron-right
                        :class="{ 'rotate-90': row.getIsExpanded() }"
                      />
                    </Button>
                  </template>
                  <template v-else-if="cell.getIsAggregated()">
                    <FlexRender
                      :render="cell.column.columnDef.cell"
                      :props="cell.getContext()"
                    />
                  </template>
                  <template v-else-if="cell.getIsPlaceholder()">
                    <FlexRender
                      :render="cell.column.columnDef.cell"
                      :props="cell.getContext()"
                    />
                  </template>
                  <template v-else>
                    <FlexRender
                      :render="cell.column.columnDef.cell"
                      :props="cell.getContext()"
                    />
                  </template>
                </TableCell>
              </TableRow>
              <!-- <TableRow v-if="row.getIsExpanded()">
                <TableCell :colspan="row.getAllCells().length" class="px-12">
                  {{ JSON.stringify(row.original) }}
                </TableCell>
              </TableRow> -->
            </template>
          </template>
          <template v-else>
            <TableRow>
              <TableCell :colspan="columns.length"> No results. </TableCell>
            </TableRow>
          </template>
        </TableBody>
      </Table>
    </OverlayScrollbarsWrapper>
  </div>
  <DataTablePagination :table="table" />
</template>
