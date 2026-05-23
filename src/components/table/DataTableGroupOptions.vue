<script lang="ts" setup generic="TData">
import { IconGroup, IconRotateCcw } from "@/data/icons"
import type { Table } from "@tanstack/vue-table"

const { t } = useI18n()

const props = defineProps<{
  table: Table<TData>
}>()

const columns = computed(() =>
  props.table
    .getAllColumns()
    .filter(
      (column) =>
        typeof column.accessorFn !== "undefined" && column.getCanGroup()
    )
)
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="outline" class="data-[state=open]:bg-accent">
        <IconGroup />
        {{ t("components.dataTable.groupBy") }}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent class="w-auto">
      <DropdownMenuLabel>{{
        t("components.dataTable.groupBy")
      }}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuCheckboxItem
          v-for="column in columns"
          :key="column.id"
          :model-value="column.getIsGrouped()"
          class="capitalize"
          @update:model-value="column.toggleGrouping"
        >
          {{ column.id }}
        </DropdownMenuCheckboxItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem @click="props.table.resetGrouping">
          <IconRotateCcw />
          {{ t("components.dataTable.groupNone") }}
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
