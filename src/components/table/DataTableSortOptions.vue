<script lang="ts" setup generic="TData">
import { IconArrowDown, IconArrowUp, IconArrowUpDown } from "@/data/icons"
import type { Table } from "@tanstack/vue-table"

const props = defineProps<{
  table: Table<TData>
}>()

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
      <Button variant="outline" class="data-[state=open]:bg-accent">
        <IconArrowUpDown />
        Sort
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
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
