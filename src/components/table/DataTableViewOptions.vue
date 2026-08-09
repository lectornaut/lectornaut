<script lang="ts" setup generic="TData extends RowData">
import {
  IconArrowLeftToLine,
  IconArrowRightToLine,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsDownUp,
  IconChevronsUpDown,
  IconRotateCcw,
  IconSettings2,
  IconSquare,
  IconSquareDashed,
  IconSquareDashedMousePointer,
  IconSquareMousePointer,
} from "@/data/icons"
import type { AppTableFeatures } from "@/components/table/features"
import type { RowData, Table } from "@tanstack/vue-table"

const props = defineProps<{
  table: Table<AppTableFeatures, TData>
}>()

const columns = computed(() =>
  props.table
    .getAllColumns()
    .filter(
      (column) =>
        typeof column.accessorFn !== "undefined" && column.getCanHide()
    )
)

const pageSizeString = computed({
  get: () => String(props.table.atoms.pagination.get().pageSize),
  set: (val: string) => {
    props.table.setPageSize(Number(val))
  },
})

function onPageSizeChange(val: unknown) {
  props.table.setPageSize(Number(val))
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="outline" class="data-[state=open]:bg-accent">
        <IconSettings2 />
        {{ $t("components.dataTable.view") }}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuLabel>
        {{ $t("components.dataTable.options") }}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuItem as-child>
          <DropdownMenuSubTrigger>
            {{ $t("components.dataTable.display") }}
          </DropdownMenuSubTrigger>
        </DropdownMenuItem>
        <DropdownMenuSubContent>
          <DropdownMenuLabel>{{
            $t("components.dataTable.columns")
          }}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuCheckboxItem
              v-for="column in columns"
              :key="column.id"
              :model-value="column.getIsVisible()"
              class="capitalize"
              @update:model-value="(value) => column.toggleVisibility(!!value)"
            >
              {{ column.id }}
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem @click="props.table.resetColumnVisibility">
              <IconRotateCcw />
              {{ $t("actions.reset") }}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuItem as-child>
          <DropdownMenuSubTrigger>
            {{ $t("actions.select") }}
          </DropdownMenuSubTrigger>
        </DropdownMenuItem>
        <DropdownMenuSubContent>
          <DropdownMenuLabel>
            {{ $t("components.dataTable.rows") }}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            @click="props.table.toggleAllPageRowsSelected(true)"
          >
            <IconSquareDashedMousePointer />
            {{ $t("components.dataTable.selectAllOnPage") }}
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="props.table.toggleAllPageRowsSelected(false)"
          >
            <IconSquareDashed />
            {{ $t("components.dataTable.clearSelectionOnPage") }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem @click="props.table.toggleAllRowsSelected(true)">
              <IconSquareMousePointer />
              {{ $t("components.dataTable.selectAll") }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="props.table.toggleAllRowsSelected(false)">
              <IconSquare />
              {{ $t("components.dataTable.clearSelection") }}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="props.table.resetRowSelection()">
              <IconRotateCcw />
              Reset
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuItem as-child>
          <DropdownMenuSubTrigger>
            {{ $t("actions.expand") }}
          </DropdownMenuSubTrigger>
        </DropdownMenuItem>
        <DropdownMenuSubContent>
          <DropdownMenuLabel>
            {{ $t("components.dataTable.rows") }}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem @click="props.table.toggleAllRowsExpanded(true)">
              <IconChevronsUpDown />
              {{ $t("components.dataTable.expandAll") }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="props.table.toggleAllRowsExpanded(false)">
              <IconChevronsDownUp />
              {{ $t("components.dataTable.collapseAll") }}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="props.table.toggleAllRowsExpanded(false)">
            <IconRotateCcw />
            Reset
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuItem as-child>
          <DropdownMenuSubTrigger>
            {{ $t("components.dataTable.pagination") }}
          </DropdownMenuSubTrigger>
        </DropdownMenuItem>
        <DropdownMenuSubContent>
          <DropdownMenuLabel>
            {{ $t("components.dataTable.pageSize") }}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuRadioGroup
              v-model="pageSizeString"
              @update:model-value="onPageSizeChange"
            >
              <DropdownMenuRadioItem
                v-for="pageSize in [5, 10, 20, 30, 40, 50]"
                :key="pageSize"
                :value="String(pageSize)"
              >
                {{ pageSize }}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="props.table.setPageSize(10)">
            <IconRotateCcw />
            Reset
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuItem as-child>
          <DropdownMenuSubTrigger>
            {{ $t("components.dataTable.navigation") }}
          </DropdownMenuSubTrigger>
        </DropdownMenuItem>
        <DropdownMenuSubContent>
          <DropdownMenuLabel>
            {{ $t("components.dataTable.goTo") }}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              :disabled="!props.table.getCanPreviousPage()"
              @click="props.table.previousPage()"
            >
              <IconChevronLeft />
              {{ $t("components.dataTable.previousPage") }}
            </DropdownMenuItem>
            <DropdownMenuItem
              :disabled="!props.table.getCanNextPage()"
              @click="props.table.nextPage()"
            >
              <IconChevronRight />
              {{ $t("components.dataTable.nextPage") }}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              :disabled="!props.table.getCanPreviousPage()"
              @click="props.table.setPageIndex(0)"
            >
              <IconArrowLeftToLine />
              {{ $t("components.dataTable.firstPage") }}
            </DropdownMenuItem>
            <DropdownMenuItem
              :disabled="!props.table.getCanNextPage()"
              @click="props.table.setPageIndex(props.table.getPageCount() - 1)"
            >
              <IconArrowRightToLine />
              {{ $t("components.dataTable.lastPage") }}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="props.table.setPageIndex(0)">
            <IconRotateCcw />
            Reset
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuItem as-child>
          <DropdownMenuSubTrigger>
            {{ $t("actions.filter") }}
          </DropdownMenuSubTrigger>
        </DropdownMenuItem>
        <DropdownMenuSubContent>
          <DropdownMenuLabel>
            {{ $t("components.dataTable.column") }}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem @click="props.table.resetColumnFilters()">
              <IconRotateCcw />
              Reset
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuItem as-child>
          <DropdownMenuSubTrigger>
            {{ $t("components.dataTable.sorting") }}
          </DropdownMenuSubTrigger>
        </DropdownMenuItem>
        <DropdownMenuSubContent>
          <DropdownMenuLabel>
            {{ $t("components.dataTable.column") }}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem @click="props.table.resetSorting()">
              <IconRotateCcw />
              Reset
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
