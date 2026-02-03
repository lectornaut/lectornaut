<script lang="ts" setup generic="TData">
import { Badge } from "@/components/ui/badge"
import { IconCalendar } from "@/data/icons"
import type { Column } from "@tanstack/vue-table"
import { computed } from "vue"

interface DateRangeValue {
  start?: string
  end?: string
}

const props = defineProps<{
  column?: Column<TData, unknown>
  title?: string
}>()

const filterValue = computed<DateRangeValue>(() => {
  const value = props.column?.getFilterValue()
  if (!value || typeof value !== "object") return {}
  return value as DateRangeValue
})

const startValue = computed({
  get: () => filterValue.value.start ?? "",
  set: (value: string) => updateFilter(value, filterValue.value.end ?? ""),
})

const endValue = computed({
  get: () => filterValue.value.end ?? "",
  set: (value: string) => updateFilter(filterValue.value.start ?? "", value),
})

const hasRange = computed(
  () => !!filterValue.value.start || !!filterValue.value.end
)

const summary = computed(() => {
  if (filterValue.value.start && filterValue.value.end) {
    return `${filterValue.value.start} – ${filterValue.value.end}`
  }
  if (filterValue.value.start) {
    return `From ${filterValue.value.start}`
  }
  if (filterValue.value.end) {
    return `Until ${filterValue.value.end}`
  }
  return ""
})

const updateFilter = (start: string, end: string) => {
  if (!props.column) return
  const normalizedStart = start || undefined
  const normalizedEnd = end || undefined
  if (!normalizedStart && !normalizedEnd) {
    props.column.setFilterValue(undefined)
    return
  }
  props.column.setFilterValue({
    start: normalizedStart,
    end: normalizedEnd,
  })
}
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button variant="outline" class="data-[state=open]:bg-accent">
        <IconCalendar />
        {{ title ?? "Date" }}
        <template v-if="hasRange">
          <Separator orientation="vertical" />
          <Badge variant="secondary">{{ summary }}</Badge>
        </template>
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-64 p-3" align="start" side="bottom">
      <div class="grid gap-3">
        <div class="space-y-1">
          <p class="text-muted-foreground text-xs">Start</p>
          <Input v-model="startValue" type="date" />
        </div>
        <div class="space-y-1">
          <p class="text-muted-foreground text-xs">End</p>
          <Input v-model="endValue" type="date" />
        </div>
        <div class="flex justify-end">
          <Button variant="ghost" size="sm" @click="updateFilter('', '')">
            Clear
          </Button>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
