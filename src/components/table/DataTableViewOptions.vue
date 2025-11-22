<script lang="ts" setup>
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
import type { Task } from "@/data/schema"
import type { Table } from "@tanstack/vue-table"

interface DataTableViewOptionsProps {
  table: Table<Task>
}

const props = defineProps<DataTableViewOptionsProps>()

const columns = computed(() =>
  props.table
    .getAllColumns()
    .filter(
      (column) =>
        typeof column.accessorFn !== "undefined" && column.getCanHide()
    )
)

const pageSizeString = computed({
  get: () => String(props.table.getState().pagination.pageSize),
  set: (val: string) => {
    props.table.setPageSize(Number(val))
  },
})

function onPageSizeChange(val: string) {
  props.table.setPageSize(Number(val))
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="outline" class="data-[state=open]:bg-accent">
        <IconSettings2 />
        View
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuLabel> Options </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuItem as-child>
          <DropdownMenuSubTrigger> Display </DropdownMenuSubTrigger>
        </DropdownMenuItem>
        <DropdownMenuSubContent>
          <DropdownMenuLabel>Columns</DropdownMenuLabel>
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
            <DropdownMenuItem @click="props.table.resetColumnVisibility()">
              <IconRotateCcw />
              Reset
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuItem as-child>
          <DropdownMenuSubTrigger> Select </DropdownMenuSubTrigger>
        </DropdownMenuItem>
        <DropdownMenuSubContent>
          <DropdownMenuLabel> Rows </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            @click="props.table.toggleAllPageRowsSelected(true)"
          >
            <IconSquareDashedMousePointer />
            Select all on page
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="props.table.toggleAllPageRowsSelected(false)"
          >
            <IconSquareDashed />
            Clear selection on page
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem @click="props.table.toggleAllRowsSelected(true)">
              <IconSquareMousePointer />
              Select all
            </DropdownMenuItem>
            <DropdownMenuItem @click="props.table.toggleAllRowsSelected(false)">
              <IconSquare />
              Clear selection
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
          <DropdownMenuSubTrigger> Expand </DropdownMenuSubTrigger>
        </DropdownMenuItem>
        <DropdownMenuSubContent>
          <DropdownMenuLabel> Rows </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem @click="props.table.toggleAllRowsExpanded(true)">
              <IconChevronsUpDown />
              Expand all
            </DropdownMenuItem>
            <DropdownMenuItem @click="props.table.toggleAllRowsExpanded(false)">
              <IconChevronsDownUp />
              Collapse all
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
          <DropdownMenuSubTrigger> Pagination </DropdownMenuSubTrigger>
        </DropdownMenuItem>
        <DropdownMenuSubContent>
          <DropdownMenuLabel> Page size </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuRadioGroup
              v-model="pageSizeString"
              @update:model-value="onPageSizeChange"
            >
              <DropdownMenuRadioItem
                v-for="pageSize in [10, 20, 30, 40, 50]"
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
          <DropdownMenuSubTrigger> Navigation </DropdownMenuSubTrigger>
        </DropdownMenuItem>
        <DropdownMenuSubContent>
          <DropdownMenuLabel> Go to </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              :disabled="!props.table.getCanPreviousPage()"
              @click="props.table.previousPage()"
            >
              <IconChevronLeft />
              Previous page
            </DropdownMenuItem>
            <DropdownMenuItem
              :disabled="!props.table.getCanNextPage()"
              @click="props.table.nextPage()"
            >
              <IconChevronRight />
              Next page
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              :disabled="!props.table.getCanPreviousPage()"
              @click="props.table.setPageIndex(0)"
            >
              <IconArrowLeftToLine />
              First page
            </DropdownMenuItem>
            <DropdownMenuItem
              :disabled="!props.table.getCanNextPage()"
              @click="props.table.setPageIndex(props.table.getPageCount() - 1)"
            >
              <IconArrowRightToLine />
              Last page
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
          <DropdownMenuSubTrigger> Filter </DropdownMenuSubTrigger>
        </DropdownMenuItem>
        <DropdownMenuSubContent>
          <DropdownMenuLabel> Column </DropdownMenuLabel>
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
          <DropdownMenuSubTrigger> Sorting </DropdownMenuSubTrigger>
        </DropdownMenuItem>
        <DropdownMenuSubContent>
          <DropdownMenuLabel> Column </DropdownMenuLabel>
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
