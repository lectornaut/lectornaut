<script lang="ts" setup generic="TData">
import {
  IconArrowLeftToLine,
  IconArrowRightToLine,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
} from "@/data/icons"
import type { Row, Table } from "@tanstack/vue-table"

defineProps<{
  table: Table<TData>
}>()

// Optional bulk-actions menu for the current selection. When a consumer wires
// this slot, the dashed count chip on the left turns into a dropdown trigger;
// otherwise it stays a plain informational chip (backward compatible).
defineSlots<{
  "selection-actions"?: (props: {
    table: Table<TData>
    rows: Row<TData>[]
    count: number
  }) => unknown
}>()
</script>

<template>
  <div
    class="flex shrink-0 items-center justify-between gap-2 overflow-x-auto p-2"
  >
    <div class="flex grow items-center justify-start gap-2">
      <template v-if="table.getFilteredSelectedRowModel().rows.length">
        <!-- Slotted bulk actions: the count chip becomes a dropdown trigger. -->
        <DropdownMenu v-if="$slots['selection-actions']">
          <DropdownMenuTrigger as-child>
            <Button
              variant="outline"
              class="data-[state=open]:bg-accent border-dashed"
            >
              {{ table.getFilteredSelectedRowModel().rows.length }} /
              {{ table.getFilteredRowModel().rows.length }}
              {{ $t("components.dataTable.selected") }}
              <IconChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" class="min-w-48">
            <slot
              name="selection-actions"
              :table="table"
              :rows="table.getFilteredSelectedRowModel().rows"
              :count="table.getFilteredSelectedRowModel().rows.length"
            />
          </DropdownMenuContent>
        </DropdownMenu>
        <!-- No slot: keep the original non-interactive informational chip. -->
        <Button v-else variant="outline" class="border-dashed">
          {{ table.getFilteredSelectedRowModel().rows.length }} /
          {{ table.getFilteredRowModel().rows.length }}
          {{ $t("components.dataTable.selected") }}
        </Button>
      </template>
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
              <SelectContent>
                <SelectGroup>
                  <SelectItem
                    v-for="pageSize in [5, 10, 20, 30, 40, 50]"
                    :key="pageSize"
                    :value="pageSize"
                  >
                    {{ pageSize }}
                  </SelectItem>
                </SelectGroup>
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
