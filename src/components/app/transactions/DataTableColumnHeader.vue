<script setup lang="ts">
import type { Task } from "@/data/schema"
import { cn } from "@/lib/utils"
import type { Column } from "@tanstack/vue-table"

interface DataTableColumnHeaderProps {
  column: Column<Task, unknown>
  title: string
}

defineProps<DataTableColumnHeaderProps>()

defineOptions({
  inheritAttrs: false,
})
</script>

<template>
  <div
    v-if="column.getCanSort()"
    :class="cn('flex items-center gap-2', $attrs.class ?? '')"
  >
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          size="sm"
          class="-ml-3 h-8 gap-2 data-[state=open]:bg-accent"
        >
          <span>{{ title }}</span>
          <icon-lucide-arrow-down v-if="column.getIsSorted() === 'desc'" />
          <icon-lucide-arrow-up v-else-if="column.getIsSorted() === 'asc'" />
          <icon-lucide-chevrons-up-down v-else />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem class="gap-2" @click="column.toggleSorting(false)">
          <icon-lucide-arrow-up />
          Asc
        </DropdownMenuItem>
        <DropdownMenuItem class="gap-2" @click="column.toggleSorting(true)">
          <icon-lucide-arrow-down />
          Desc
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem class="gap-2" @click="column.toggleVisibility(false)">
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
