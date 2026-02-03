<script lang="ts" setup generic="TData">
import { IconSearch } from "@/data/icons"
import type { Table } from "@tanstack/vue-table"
import { computed } from "vue"

const props = defineProps<{
  table: Table<TData>
  columnId?: string
}>()

const activeColumn = computed(() =>
  props.table.getColumn(props.columnId ?? "title")
)
</script>

<template>
  <div v-if="activeColumn" class="relative">
    <span
      class="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center px-3"
    >
      <IconSearch />
    </span>
    <Input
      placeholder="Search"
      :model-value="(activeColumn.getFilterValue() as string) ?? ''"
      class="pl-9"
      @input="
        activeColumn.setFilterValue(($event.target as HTMLInputElement).value)
      "
    />
  </div>
</template>
