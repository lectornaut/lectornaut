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
      <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem
        v-for="column in columns"
        :key="column.id"
        :model-value="column.getIsVisible()"
        class="capitalize"
        @update:model-value="(value) => column.toggleVisibility(!!value)"
      >
        {{ column.id }}
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem @click="props.table.resetColumnVisibility()">
        <icon-lucide-refresh-cw />
        Reset
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
