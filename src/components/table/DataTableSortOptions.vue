<script lang="ts" setup>
import { IconArrowDown, IconArrowUp, IconArrowUpDown } from "@/data/icons"
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
        typeof column.accessorFn !== "undefined" && column.getCanSort()
    )
)
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="outline">
        <IconArrowUpDown />
        Sort
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuLabel>Sort by</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuSub v-for="column in columns" :key="column.id">
          <DropdownMenuItem as-child>
            <DropdownMenuSubTrigger :key="column.id" class="capitalize">
              {{ column.id }}
            </DropdownMenuSubTrigger>
          </DropdownMenuItem>
          <DropdownMenuSubContent>
            <DropdownMenuLabel>Order</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem @click="column.toggleSorting(false)">
                <IconArrowUp />
                Ascending
              </DropdownMenuItem>
              <DropdownMenuItem @click="column.toggleSorting(true)">
                <IconArrowDown />
                Descending
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem @click="props.table.resetSorting()">
          None
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
