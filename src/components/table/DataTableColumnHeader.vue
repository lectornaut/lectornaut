<script setup lang="ts">
import type { Task } from "@/data/schema"
import type { Column } from "@tanstack/vue-table"

interface DataTableColumnHeaderProps {
  column: Column<Task, unknown>
  title: string
}

defineProps<DataTableColumnHeaderProps>()
</script>

<script lang="ts">
export default {
  inheritAttrs: false,
}
</script>

<template>
  <div v-if="column.getCanSort()">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" class="data-[state=open]:bg-accent">
          {{ title }}
          <icon-lucide-arrow-down v-if="column.getIsSorted() === 'desc'" />
          <icon-lucide-arrow-up v-else-if="column.getIsSorted() === 'asc'" />
          <icon-lucide-chevrons-up-down v-else />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom">
        <DropdownMenuItem @click="column.toggleSorting(false)">
          <icon-lucide-arrow-up />
          Ascending
        </DropdownMenuItem>
        <DropdownMenuItem @click="column.toggleSorting(true)">
          <icon-lucide-arrow-down />
          Descending
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem @click="column.toggleVisibility(false)">
          <icon-lucide-eye-off />
          Hide
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
  <div v-else :class="$attrs.class">
    {{ title }}
  </div>
</template>
