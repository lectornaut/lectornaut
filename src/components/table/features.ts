/**
 * The single TanStack Table v9 feature registry for every DataTable surface.
 * v9 requires features, row models, and sort/filter fns to be registered up
 * front; `DataTable.vue` (the one construction site) consumes this object, and
 * column/consumer files reference `AppTableFeatures` in their generics.
 *
 * Row-model slots must come after their owning feature in this call — that
 * ordering is type-checked by `tableFeatures()`.
 */
import {
  columnFacetingFeature,
  columnFilteringFeature,
  columnGroupingFeature,
  columnPinningFeature,
  columnVisibilityFeature,
  createExpandedRowModel,
  createFacetedRowModel,
  createFacetedUniqueValues,
  createFilteredRowModel,
  createGroupedRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFns,
  globalFilteringFeature,
  rowExpandingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
} from "@tanstack/vue-table"

export const features = tableFeatures({
  columnFacetingFeature,
  columnFilteringFeature,
  columnGroupingFeature,
  columnPinningFeature,
  columnVisibilityFeature,
  globalFilteringFeature,
  rowExpandingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  expandedRowModel: createExpandedRowModel(),
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  filteredRowModel: createFilteredRowModel(),
  groupedRowModel: createGroupedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  // Full registries (not per-fn imports): string refs like `sortFn: "basic"`
  // and the `'auto'` defaults only resolve fns registered here, and the shared
  // DataTable serves columns from many surfaces — v8-parity beats tree-shaving
  // a few KB and silently losing an `'auto'` sort or the global text filter.
  filterFns,
  sortFns,
})

export type AppTableFeatures = typeof features
