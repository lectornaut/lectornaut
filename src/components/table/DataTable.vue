<script lang="ts" setup generic="TData">
import { valueUpdater } from "@/components/ui/table/utils"
import { IconChevronRight, IconDatabase, IconListFilter } from "@/data/icons"
import type {
  ColumnDef,
  ColumnFiltersState,
  ColumnPinningState,
  ExpandedState,
  GroupingState,
  Row,
  SortingState,
  Table,
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

/**
 * When a surface provides an `#expanded` slot, rows become click-to-expand and
 * render a detail row beneath. Opt-in so every other table keeps its current
 * behaviour untouched (grouped tables still expand via their group toggle).
 */
const slots = defineSlots<{
  expanded?: (props: { row: Row<TData> }) => unknown
  /**
   * Bulk actions for the current row selection. When provided, the footer's
   * selected-count chip turns into a dropdown trigger that renders these items.
   */
  "selection-actions"?: (props: {
    table: Table<TData>
    rows: Row<TData>[]
    count: number
  }) => unknown
}>()
const hasExpandedSlot = computed(() => !!slots.expanded)

/** Columns whose own click shouldn't toggle row expansion (their controls own it). */
const NON_EXPAND_COLUMNS = new Set(["select", "actions"])

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
  // Let leaf rows expand to a detail row when an `#expanded` slot is provided;
  // otherwise fall back to the default (only rows with subRows, i.e. groups).
  getRowCanExpand: hasExpandedSlot.value ? () => true : undefined,
})

/** Click a row body to toggle its detail row (skips group rows + control cells). */
function onRowToggleExpand(row: {
  getIsGrouped: () => boolean
  toggleExpanded: () => void
}): void {
  if (!hasExpandedSlot.value || row.getIsGrouped()) return
  row.toggleExpanded()
}

/** Stop a control column's click (select / actions) from also toggling the row. */
function onCellClick(columnId: string, event: MouseEvent): void {
  if (hasExpandedSlot.value && NON_EXPAND_COLUMNS.has(columnId))
    event.stopPropagation()
}

defineExpose({ table })
</script>

<template>
  <div class="grid min-h-0 min-w-0 grow grid-cols-1 grid-rows-1">
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
      <!-- `data-table-viewport` turns the Table's own container into the one
           native scroller (scroll-fade + thin scrollbar via index.css) so the
           sticky header and pinned columns stick to it. -->
      <div
        data-table-viewport
        class="relative flex min-h-0 min-w-0 grow flex-col overflow-hidden"
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
                    hasExpandedSlot && !row.getIsGrouped() && 'cursor-pointer',
                  ]"
                  @click="onRowToggleExpand(row)"
                >
                  <TableCell
                    v-for="cell in row.getVisibleCells()"
                    :key="cell.id"
                    :data-pinned="cell.column.getIsPinned()"
                    :class="[
                      {
                        'from-card/50 sticky from-50%':
                          cell.column.getIsPinned(),
                      },
                      cell.column.getIsPinned() === 'left'
                        ? 'left-0 bg-linear-to-r'
                        : cell.column.getIsPinned() === 'right'
                          ? 'right-0 bg-linear-to-l'
                          : '',
                    ]"
                    @click="onCellClick(cell.column.id, $event)"
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
                <!-- Opt-in detail row: rendered only for leaf rows when an
                   `#expanded` slot is provided and the row is expanded. -->
                <TableRow
                  v-if="
                    hasExpandedSlot &&
                    row.getIsExpanded() &&
                    !row.getIsGrouped()
                  "
                  :data-expanded="'expanded'"
                  class="hover:bg-transparent"
                >
                  <!-- `whitespace-normal` resets TableCell's default
                     `whitespace-nowrap`: detail content is free-form and must
                     wrap, or a long line would set the table's min-content and
                     stretch every column when a row expands. -->
                  <TableCell
                    :colspan="row.getVisibleCells().length"
                    class="bg-muted/30 p-0 whitespace-normal"
                  >
                    <slot name="expanded" :row="row" />
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
      </div>
      <DataTablePagination v-if="props.showPagination" :table="table">
        <!-- Guarded so the child only "sees" the slot when our own consumer
           provided one — an unconditional forward would always register it. -->
        <template
          v-if="$slots['selection-actions']"
          #selection-actions="slotProps"
        >
          <slot name="selection-actions" v-bind="slotProps" />
        </template>
      </DataTablePagination>
    </div>
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
