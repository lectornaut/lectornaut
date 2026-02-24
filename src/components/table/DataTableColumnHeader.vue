<script lang="ts" setup generic="TData">
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronsUpDown,
  IconEyeOff,
} from "@/data/icons"
import type { Column } from "@tanstack/vue-table"

defineProps<{
  column: Column<TData, unknown>
  title: string
}>()

defineOptions({
  inheritAttrs: false,
})
</script>

<template>
  <div v-if="column.getCanSort()">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" class="data-[state=open]:bg-accent">
          {{ title }}
          <IconArrowDown v-if="column.getIsSorted() === 'desc'" />
          <IconArrowUp v-else-if="column.getIsSorted() === 'asc'" />
          <IconChevronsUpDown v-else />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom">
        <DropdownMenuItem @click="column.toggleSorting(false)">
          <IconArrowUp />
          Ascending
        </DropdownMenuItem>
        <DropdownMenuItem @click="column.toggleSorting(true)">
          <IconArrowDown />
          Descending
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem @click="column.toggleVisibility(false)">
          <IconEyeOff />
          Hide
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
  <div v-else :class="$attrs.class as string">
    {{ title }}
  </div>
</template>
