<script lang="ts" setup generic="TData">
import { IconSearch } from "@/data/icons"
import type { Table } from "@tanstack/vue-table"

const { t } = useI18n()

const props = defineProps<{
  table: Table<TData>
}>()
</script>

<template>
  <div class="relative">
    <span
      class="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center px-3"
    >
      <IconSearch />
    </span>
    <Input
      :placeholder="t('components.dataTable.search')"
      :model-value="(props.table.getState().globalFilter as string) ?? ''"
      class="pl-9"
      @input="
        props.table.setGlobalFilter(($event.target as HTMLInputElement).value)
      "
    />
  </div>
</template>
