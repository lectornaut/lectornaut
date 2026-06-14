<script lang="ts" setup generic="TData">
import { IconCalendar } from "@/data/icons"
import { getLocalTimeZone, parseDate, today } from "@internationalized/date"
import type { Column } from "@tanstack/vue-table"
import type { DateRange } from "reka-ui"
import { computed, ref } from "vue"

const { t } = useI18n()

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
    label: t("pages.home.presets.today"),
  },
  {
    id: 7,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 7,
      }),
      end: today(getLocalTimeZone()),
    },
    label: t("pages.home.presets.last7days"),
  },
  {
    id: 14,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 14,
      }),
      end: today(getLocalTimeZone()),
    },
    label: t("pages.home.presets.last14days"),
  },
  {
    id: 30,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 30,
      }),
      end: today(getLocalTimeZone()),
    },
    label: t("pages.home.presets.last30days"),
  },
  {
    id: 90,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 90,
      }),
      end: today(getLocalTimeZone()),
    },
    label: t("pages.home.presets.last3months"),
  },
  {
    id: 180,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 180,
      }),
      end: today(getLocalTimeZone()),
    },
    label: t("pages.home.presets.last6months"),
  },
  {
    id: 365,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 365,
      }),
      end: today(getLocalTimeZone()),
    },
    label: t("pages.home.presets.last1year"),
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
    return t("components.dataTable.rangeBoth", {
      start: filterValue.value.start,
      end: filterValue.value.end,
    })
  }
  if (filterValue.value.start) {
    return t("components.dataTable.from", { date: filterValue.value.start })
  }
  if (filterValue.value.end) {
    return t("components.dataTable.until", { date: filterValue.value.end })
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
        {{ title ?? t("components.dataTable.dateLabel") }}
        <template v-if="hasRange">
          <Separator orientation="vertical" />
          <Badge variant="secondary">{{ summary }}</Badge>
        </template>
      </Button>
    </PopoverTrigger>
    <PopoverContent class="grid w-full">
      <div class="p-2">
        <Select v-model="range">
          <Button variant="outline" class="w-full justify-between" as-child>
            <SelectTrigger>
              <SelectValue
                :placeholder="t('components.dataTable.selectRange')"
              />
            </SelectTrigger>
          </Button>
          <SelectContent>
            <SelectGroup>
              <SelectItem
                v-for="preset in presets"
                :key="preset.id"
                :value="preset.value"
              >
                {{ preset.label }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <RangeCalendar
        v-model="range"
        :max-value="today(getLocalTimeZone())"
        initial-focus
        class="p-2"
      />
      <Button variant="ghost" @click="clearFilter">
        {{ t("components.dataTable.clearFilters") }}
      </Button>
    </PopoverContent>
  </Popover>
</template>
