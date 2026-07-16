<script lang="ts" setup>
// A range calendar that doubles as a runs filter: each day cell shows a dot
// for past runs (coloured by the day's most attention-worthy status) and an
// outline dot for days with a scheduled run. Built on the same reka-ui
// primitives as `ui/range-calendar` so it matches the app's calendar styling.
import {
  RangeCalendarCell,
  RangeCalendarCellTrigger,
  RangeCalendarGrid,
  RangeCalendarGridBody,
  RangeCalendarGridHead,
  RangeCalendarGridRow,
  RangeCalendarHeadCell,
  RangeCalendarHeader,
  RangeCalendarHeading,
  RangeCalendarNextButton,
  RangeCalendarPrevButton,
} from "@/components/ui/range-calendar"
import {
  dateKeyFromParts,
  type CalDate,
  type DayMarker,
  type RunsDateRange,
} from "@/composables/useRunsExplorer"
import { RangeCalendarRoot } from "reka-ui"

const props = defineProps<{
  modelValue?: RunsDateRange
  markers: Map<string, DayMarker>
}>()

const emit = defineEmits<{
  "update:modelValue": [value: RunsDateRange | undefined]
}>()

const markerFor = (d: CalDate): DayMarker | undefined =>
  props.markers.get(dateKeyFromParts(d.year, d.month, d.day))
</script>

<template>
  <RangeCalendarRoot
    v-slot="{ grid, weekDays }"
    :model-value="props.modelValue as never"
    class="p-1"
    @update:model-value="
      (v) => emit('update:modelValue', v as unknown as RunsDateRange)
    "
  >
    <RangeCalendarHeader>
      <RangeCalendarHeading />
      <div class="flex items-center gap-1">
        <RangeCalendarPrevButton />
        <RangeCalendarNextButton />
      </div>
    </RangeCalendarHeader>

    <div class="mt-4 flex flex-col gap-y-4">
      <RangeCalendarGrid v-for="month in grid" :key="month.value.toString()">
        <RangeCalendarGridHead>
          <RangeCalendarGridRow>
            <RangeCalendarHeadCell v-for="day in weekDays" :key="day">
              {{ day }}
            </RangeCalendarHeadCell>
          </RangeCalendarGridRow>
        </RangeCalendarGridHead>
        <RangeCalendarGridBody>
          <RangeCalendarGridRow
            v-for="(weekDates, index) in month.rows"
            :key="`weekDate-${index}`"
            class="mt-2 w-full"
          >
            <RangeCalendarCell
              v-for="weekDate in weekDates"
              :key="weekDate.toString()"
              :date="weekDate"
            >
              <RangeCalendarCellTrigger
                :day="weekDate"
                :month="month.value"
                class="relative"
              >
                <span>{{ weekDate.day }}</span>
                <span
                  v-if="markerFor(weekDate)"
                  class="absolute inset-x-0 bottom-0.5 flex items-center justify-center gap-0.5"
                >
                  <span
                    v-if="markerFor(weekDate)!.dotClass"
                    class="size-1 rounded-md"
                    :class="markerFor(weekDate)!.dotClass"
                  />
                  <span
                    v-if="markerFor(weekDate)!.scheduled"
                    class="size-1 rounded-md border border-current opacity-50"
                  />
                </span>
              </RangeCalendarCellTrigger>
            </RangeCalendarCell>
          </RangeCalendarGridRow>
        </RangeCalendarGridBody>
      </RangeCalendarGrid>
    </div>
  </RangeCalendarRoot>
</template>
