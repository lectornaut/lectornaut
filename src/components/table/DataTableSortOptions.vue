<script lang="ts" setup generic="TData">
import { IconArrowDown, IconArrowUp, IconArrowUpDown } from "@/data/icons"
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
        typeof column.accessorFn !== "undefined" && column.getCanSort()
    )
)
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="outline" class="data-[state=open]:bg-accent">
        <IconArrowUpDown />
        {{ t("components.dataTable.sort") }}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent class="w-auto">
      <DropdownMenuLabel>{{
        t("components.dataTable.sortByLabel")
      }}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuSub v-for="column in columns" :key="column.id">
          <DropdownMenuItem as-child>
            <DropdownMenuSubTrigger :key="column.id" class="capitalize">
              {{ column.id }}
            </DropdownMenuSubTrigger>
          </DropdownMenuItem>
          <DropdownMenuSubContent class="w-auto">
            <DropdownMenuLabel>{{
              t("components.dataTable.sortOrder")
            }}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem @click="column.toggleSorting(false)">
                <IconArrowUp />
                {{ t("components.dataTable.ascending") }}
              </DropdownMenuItem>
              <DropdownMenuItem @click="column.toggleSorting(true)">
                <IconArrowDown />
                {{ t("components.dataTable.descending") }}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem @click="props.table.resetSorting()">
          {{ t("components.dataTable.sortReset") }}
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
