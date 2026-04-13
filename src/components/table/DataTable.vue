<script lang="ts" setup generic="TData">
import { valueUpdater } from "@/components/ui/table/utils"
import { IconChevronRight, IconDatabase, IconListFilter } from "@/data/icons"
import type {
  ColumnDef,
  ColumnFiltersState,
  ColumnPinningState,
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

const props = withDefaults(
  defineProps<{
    columns: ColumnDef<TData, unknown>[]
    data: TData[]
    columnPinning?: ColumnPinningState
    stickyHeader?: boolean
    showToolbar?: boolean
    showPagination?: boolean
    paginate?: boolean
    showSearch?: boolean
    showFilters?: boolean
    showGrouping?: boolean
    showSorting?: boolean
    showViewOptions?: boolean
  }>(),
  {
    columnPinning: () => ({
      left: ["select"],
      right: ["actions"],
    }),
    stickyHeader: false,
    showToolbar: true,
    showPagination: true,
    paginate: true,
    showSearch: true,
    showFilters: true,
    showGrouping: true,
    showSorting: true,
    showViewOptions: true,
  }
)

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
    get columnPinning() {
      return props.columnPinning
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
  getPaginationRowModel: props.paginate ? getPaginationRowModel() : undefined,
  getSortedRowModel: getSortedRowModel(),
  getFacetedRowModel: getFacetedRowModel(),
  getFacetedUniqueValues: getFacetedUniqueValues(),
  getExpandedRowModel: getExpandedRowModel(),
  getGroupedRowModel: getGroupedRowModel(),
})

defineExpose({ table })
</script>

<template>
  <div class="flex min-h-0 min-w-0 grow flex-col divide-y">
    <DataTableToolbar
      v-if="props.showToolbar"
      :table="table"
      :show-search="props.showSearch"
      :show-filters="props.showFilters"
      :show-grouping="props.showGrouping"
      :show-sorting="props.showSorting"
      :show-view-options="props.showViewOptions"
    />
    <OverlayScrollbarsWrapper
      show-inline-hints
      target-selector="[data-slot='table-container']"
    >
      <Table>
        <TableHeader :class="props.stickyHeader && 'sticky top-0 z-20'">
          <TableRow
            v-for="headerGroup in table.getHeaderGroups()"
            :key="headerGroup.id"
          >
            <TableHead
              v-for="header in headerGroup.headers"
              :key="header.id"
              :data-pinned="header.column.getIsPinned()"
              :class="[
                props.stickyHeader && 'bg-background top-0',
                {
                  'from-card/50 sticky from-50%': header.column.getIsPinned(),
                },
                header.column.getIsPinned() === 'left'
                  ? 'left-0 bg-linear-to-r'
                  : header.column.getIsPinned() === 'right'
                    ? 'right-0 bg-linear-to-l'
                    : '',
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
                      ? 'left-0 bg-linear-to-r'
                      : cell.column.getIsPinned() === 'right'
                        ? 'right-0 bg-linear-to-l'
                        : '',
                  ]"
                >
                  <template v-if="cell.getIsGrouped()">
                    <Button
                      variant="link"
                      class="text-inherit"
                      @click="row.getToggleExpandedHandler()()"
                    >
                      <FlexRender
                        :render="cell.column.columnDef.cell"
                        :props="cell.getContext()"
                      />
                      <span class="text-muted-foreground">
                        {{ row.subRows.length }}
                      </span>
                      <IconChevronRight
                        :class="{ 'rotate-90': row.getIsExpanded() }"
                      />
                    </Button>
                  </template>
                  <template v-else>
                    <FlexRender
                      :render="cell.column.columnDef.cell"
                      :props="cell.getContext()"
                    />
                  </template>
                </TableCell>
              </TableRow>
            </template>
          </template>
          <template v-else>
            <TableRow>
              <TableCell :colspan="props.columns.length">
                <Empty v-if="!props.data || props.data.length === 0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <IconDatabase />
                    </EmptyMedia>
                    <EmptyTitle>{{ $t("empty.noData") }}</EmptyTitle>
                    <EmptyDescription>
                      {{ $t("empty.noResults") }}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
                <Empty v-else>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <IconListFilter />
                    </EmptyMedia>
                    <EmptyTitle>{{ $t("empty.noFilteredData") }}</EmptyTitle>
                    <EmptyDescription>
                      {{ $t("empty.resetFilters") }}
                    </EmptyDescription>
                    <Button
                      variant="outline"
                      class="mt-4"
                      @click="table.resetColumnFilters()"
                    >
                      {{ $t("actions.resetFilters") }}
                    </Button>
                  </EmptyHeader>
                </Empty>
              </TableCell>
            </TableRow>
          </template>
        </TableBody>
      </Table>
    </OverlayScrollbarsWrapper>
    <DataTablePagination v-if="props.showPagination" :table="table" />
  </div>
</template>

<style scoped>
:deep([data-slot="table-container"]) {
  flex: 1 1 0%;
  min-width: 0;
  min-height: 0;
  height: 100%;
}
</style>
