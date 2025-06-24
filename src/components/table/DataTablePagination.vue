<script setup lang="ts">
import type { Task } from "@/data/schema"
import type { Table } from "@tanstack/vue-table"

interface DataTablePaginationProps {
  table: Table<Task>
}
defineProps<DataTablePaginationProps>()
</script>

<template>
  <div class="grid grid-cols-3 items-center gap-2 p-2">
    <div class="flex grow items-center justify-start gap-2">
      <Button
        v-if="table.getFilteredSelectedRowModel().rows.length"
        variant="outline"
        class="border-dashed"
      >
        {{ table.getFilteredSelectedRowModel().rows.length }} /
        {{ table.getFilteredRowModel().rows.length }} selected
      </Button>
    </div>
    <div class="flex grow items-center justify-center gap-2">
      <span class="text-muted-foreground font-mono text-xs">
        {{ table.getState().pagination.pageIndex + 1 }} /
        {{ table.getPageCount() }} pages
      </span>
    </div>
    <div class="flex grow items-center justify-end gap-2">
      <TooltipProvider>
        <Tooltip>
          <Select
            v-model="table.getState().pagination.pageSize"
            @update:model-value="table.setPageSize($event as number)"
          >
            <TooltipTrigger as-child>
              <SelectTrigger>
                <SelectValue
                  :placeholder="String(table.getState().pagination.pageSize)"
                />
              </SelectTrigger>
              <SelectContent side="top">
                <SelectItem
                  v-for="pageSize in [10, 20, 30, 40, 50]"
                  :key="pageSize"
                  :value="pageSize"
                >
                  {{ pageSize }}
                </SelectItem>
              </SelectContent>
            </TooltipTrigger>
            <TooltipContent>Rows per page</TooltipContent>
          </Select>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="outline"
              size="icon"
              :disabled="!table.getCanPreviousPage()"
              @click="table.setPageIndex(0)"
            >
              <icon-lucide-arrow-left-to-line />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Go to first page</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="outline"
              size="icon"
              :disabled="!table.getCanPreviousPage()"
              @click="table.previousPage()"
            >
              <icon-lucide-chevron-left />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Go to previous page</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="outline"
              size="icon"
              :disabled="!table.getCanNextPage()"
              @click="table.nextPage()"
            >
              <icon-lucide-chevron-right />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Go to next page</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="outline"
              size="icon"
              :disabled="!table.getCanNextPage()"
              @click="table.setPageIndex(table.getPageCount() - 1)"
            >
              <icon-lucide-arrow-right-to-line />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Go to last page</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  </div>
</template>
