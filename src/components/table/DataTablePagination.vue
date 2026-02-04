<script lang="ts" setup generic="TData">
import {
  IconArrowLeftToLine,
  IconArrowRightToLine,
  IconChevronLeft,
  IconChevronRight,
} from "@/data/icons"
import type { Table } from "@tanstack/vue-table"

defineProps<{
  table: Table<TData>
}>()
</script>

<template>
  <div class="bg-background flex items-center justify-between gap-2 p-2">
    <div class="flex grow items-center justify-start gap-2">
      <Button
        v-if="table.getFilteredSelectedRowModel().rows.length"
        variant="outline"
        class="border-dashed"
      >
        {{ table.getFilteredSelectedRowModel().rows.length }} /
        {{ table.getFilteredRowModel().rows.length }}
        {{ $t("components.dataTable.selected") }}
      </Button>
    </div>
    <div class="flex grow items-center justify-end gap-2">
      <TooltipProvider>
        <span>
          {{ $t("components.dataTable.rowsPerPage") }}
        </span>
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
                  v-for="pageSize in [5, 10, 20, 30, 40, 50]"
                  :key="pageSize"
                  :value="pageSize"
                >
                  {{ pageSize }}
                </SelectItem>
              </SelectContent>
            </TooltipTrigger>
            <TooltipContent>{{
              $t("components.dataTable.rowsPerPage")
            }}</TooltipContent>
          </Select>
        </Tooltip>
        <span>
          {{
            $t("components.dataTable.page", {
              page: table.getState().pagination.pageIndex + 1,
              pages: table.getPageCount(),
            })
          }}
        </span>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="outline"
              size="icon"
              :disabled="!table.getCanPreviousPage()"
              @click="table.setPageIndex(0)"
            >
              <IconArrowLeftToLine />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{
            $t("components.dataTable.goToFirstPage")
          }}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="outline"
              size="icon"
              :disabled="!table.getCanPreviousPage()"
              @click="table.previousPage()"
            >
              <IconChevronLeft />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{
            $t("components.dataTable.goToPreviousPage")
          }}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="outline"
              size="icon"
              :disabled="!table.getCanNextPage()"
              @click="table.nextPage()"
            >
              <IconChevronRight />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{
            $t("components.dataTable.goToNextPage")
          }}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="outline"
              size="icon"
              :disabled="!table.getCanNextPage()"
              @click="table.setPageIndex(table.getPageCount() - 1)"
            >
              <IconArrowRightToLine />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{
            $t("components.dataTable.goToLastPage")
          }}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  </div>
</template>
