<script setup lang="ts">
import type { Task } from "@/data/schema"
import type { Table } from "@tanstack/vue-table"

interface DataTablePaginationProps {
  table: Table<Task>
}
defineProps<DataTablePaginationProps>()
</script>

<template>
  <div class="flex items-center justify-between">
    <div class="truncate px-2 py-1 text-muted-foreground">
      {{ table.getFilteredSelectedRowModel().rows.length }} of
      {{ table.getFilteredRowModel().rows.length }} row(s) selected.
    </div>
    <div class="flex grow items-center justify-end gap-4">
      <div class="flex items-center gap-2">
        <span class="flex truncate">Rows per page</span>
        <Select
          :model-value="`${table.getState().pagination.pageSize}`"
          @update:model-value="table.setPageSize(parseInt($event, 10))"
        >
          <SelectTrigger class="h-7 w-auto gap-1 px-2">
            <SelectValue
              :placeholder="`${table.getState().pagination.pageSize}`"
            />
          </SelectTrigger>
          <SelectContent side="top">
            <SelectItem
              v-for="pageSize in [10, 20, 30, 40, 50]"
              :key="pageSize"
              :value="`${pageSize}`"
            >
              {{ pageSize }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="flex items-center">
        Page {{ table.getState().pagination.pageIndex + 1 }} of
        {{ table.getPageCount() }}
      </div>
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="xs"
          class="hidden lg:flex"
          :disabled="!table.getCanPreviousPage()"
          @click="table.setPageIndex(0)"
        >
          <span class="sr-only">Go to first page</span>
          <icon-lucide-chevrons-left />
        </Button>
        <Button
          variant="outline"
          size="xs"
          :disabled="!table.getCanPreviousPage()"
          @click="table.previousPage()"
        >
          <span class="sr-only">Go to previous page</span>
          <icon-lucide-chevron-left />
        </Button>
        <Button
          variant="outline"
          size="xs"
          :disabled="!table.getCanNextPage()"
          @click="table.nextPage()"
        >
          <span class="sr-only">Go to next page</span>
          <icon-lucide-chevron-right />
        </Button>
        <Button
          variant="outline"
          size="xs"
          class="hidden lg:flex"
          :disabled="!table.getCanNextPage()"
          @click="table.setPageIndex(table.getPageCount() - 1)"
        >
          <span class="sr-only">Go to last page</span>
          <icon-lucide-chevrons-right />
        </Button>
      </div>
    </div>
  </div>
</template>
