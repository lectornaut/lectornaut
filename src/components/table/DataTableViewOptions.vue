<script setup lang="ts">
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
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="outline">
        <icon-lucide-settings-2 />
        View
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuLabel> Options </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger> Display </DropdownMenuSubTrigger>
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
              <icon-lucide-rotate-ccw />
              Reset
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger> Select </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuLabel> Rows </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            @click="props.table.toggleAllPageRowsSelected(true)"
          >
            <icon-lucide-square-dashed-mouse-pointer />
            Select all on page
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="props.table.toggleAllPageRowsSelected(false)"
          >
            <icon-lucide-square-dashed />
            Clear selection on page
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem @click="props.table.toggleAllRowsSelected(true)">
              <icon-lucide-square-mouse-pointer />
              Select all
            </DropdownMenuItem>
            <DropdownMenuItem @click="props.table.toggleAllRowsSelected(false)">
              <icon-lucide-square />
              Clear selection
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="props.table.resetRowSelection()">
              <icon-lucide-rotate-ccw />
              Reset
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger> Expand </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuLabel> Rows </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem @click="props.table.toggleAllRowsExpanded(true)">
              <icon-lucide-chevrons-up-down />
              Expand all
            </DropdownMenuItem>
            <DropdownMenuItem @click="props.table.toggleAllRowsExpanded(false)">
              <icon-lucide-chevrons-down-up />
              Collapse all
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="props.table.toggleAllRowsExpanded(false)">
            <icon-lucide-rotate-ccw />
            Reset
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger> Pagination </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuLabel> Page size </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuRadioGroup
              v-model="props.table.getState().pagination.pageSize"
              :model-value="props.table.getState().pagination.pageSize"
              @update:model-value="props.table.setPageSize"
            >
              <DropdownMenuRadioItem
                v-for="pageSize in [10, 20, 30, 40, 50]"
                :key="pageSize"
                :value="pageSize"
              >
                {{ pageSize }}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="props.table.setPageSize(10)">
            <icon-lucide-rotate-ccw />
            Reset
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger> Navigation </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuLabel> Go to </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              :disabled="!props.table.getCanPreviousPage()"
              @click="props.table.previousPage()"
            >
              <icon-lucide-chevron-left />
              Previous page
            </DropdownMenuItem>
            <DropdownMenuItem
              :disabled="!props.table.getCanNextPage()"
              @click="props.table.nextPage()"
            >
              <icon-lucide-chevron-right />
              Next page
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              :disabled="!props.table.getCanPreviousPage()"
              @click="props.table.setPageIndex(0)"
            >
              <icon-lucide-arrow-left-to-line />
              First page
            </DropdownMenuItem>
            <DropdownMenuItem
              :disabled="!props.table.getCanNextPage()"
              @click="props.table.setPageIndex(props.table.getPageCount() - 1)"
            >
              <icon-lucide-arrow-right-to-line />
              Last page
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="props.table.setPageIndex(0)">
            <icon-lucide-rotate-ccw />
            Reset
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger> Filter </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuLabel> Column </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem @click="props.table.resetColumnFilters()">
              <icon-lucide-rotate-ccw />
              Reset
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger> Sorting </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuLabel> Column </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem @click="props.table.resetSorting()">
              <icon-lucide-rotate-ccw />
              Reset
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
