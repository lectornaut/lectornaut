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

const presets = computed(() => [
  {
    id: 0,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 0,
      }),
      end: today(getLocalTimeZone()),
    },
    label: "Today",
  },
  {
    id: 7,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 7,
      }),
      end: today(getLocalTimeZone()),
    },
    label: "Last 7 days",
  },
  {
    id: 14,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 14,
      }),
      end: today(getLocalTimeZone()),
    },
    label: "Last 14 days",
  },
  {
    id: 30,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 30,
      }),
      end: today(getLocalTimeZone()),
    },
    label: "Last 30 days",
  },
  {
    id: 90,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 90,
      }),
      end: today(getLocalTimeZone()),
    },
    label: "Last 3 months",
  },
  {
    id: 180,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 180,
      }),
      end: today(getLocalTimeZone()),
    },
    label: "Last 6 months",
  },
  {
    id: 365,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 365,
      }),
      end: today(getLocalTimeZone()),
    },
    label: "Last 1 year",
  },
])

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
    <PopoverContent class="grid w-full p-0" align="start" side="bottom">
      <div class="p-2">
        <Select v-model="range">
          <SelectTrigger class="w-full">
            <SelectValue placeholder="Select range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="preset in presets"
              :key="preset.id"
              :value="preset.value"
            >
              {{ preset.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Separator />
      <RangeCalendar
        v-model="range"
        :max-value="today(getLocalTimeZone())"
        initial-focus
        class="p-2"
      />
      <Separator />
      <div class="grid p-2">
        <Button variant="ghost" size="sm" @click="clearFilter">
          Clear filters
        </Button>
      </div>
    </PopoverContent>
  </Popover>
</template>
