<script lang="ts" setup generic="TData">
import { IconCalendar } from "@/data/icons"
import { getLocalTimeZone, parseDate, today } from "@internationalized/date"
import type { Column } from "@tanstack/vue-table"
import type { DateRange } from "reka-ui"
import { computed, ref } from "vue"

interface DateRangeValue {
  start?: string
  end?: string
}

const props = defineProps<{
  column?: Column<TData, unknown>
  title?: string
}>()

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

const filterValue = computed<DateRangeValue>(() => {
  const value = props.column?.getFilterValue()
  if (!value || typeof value !== "object") return {}
  return value as DateRangeValue
})

const range = computed<DateRange | undefined>({
  get: () => {
    if (!filterValue.value.start && !filterValue.value.end) return undefined
    try {
      return {
        start: filterValue.value.start
          ? parseDate(filterValue.value.start)
          : undefined,
        end: filterValue.value.end
          ? parseDate(filterValue.value.end)
          : undefined,
      } as DateRange
    } catch {
      return undefined
    }
  },
  set: (val) => {
    if (!val) {
      updateFilter("", "")
      return
    }
    const start = val.start ? val.start.toString() : ""
    const end = val.end ? val.end.toString() : ""
    updateFilter(start, end)
  },
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

const isOpen = ref(false)

const clearFilter = () => {
  updateFilter("", "")
  isOpen.value = false
}
</script>

<template>
  <Popover v-model:open="isOpen">
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
    <PopoverContent class="w-auto p-0" align="start" side="bottom">
      <RangeCalendar
        v-model="range"
        :max-value="today(getLocalTimeZone())"
        initial-focus
      />
      <Separator />
      <div class="grid p-3">
        <Button variant="secondary" size="sm" @click="clearFilter">
          Clear
        </Button>
      </div>
    </PopoverContent>
  </Popover>
</template>
