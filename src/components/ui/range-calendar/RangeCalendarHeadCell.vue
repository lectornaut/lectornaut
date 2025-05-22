<script lang="ts" setup>
import { cn } from "@/lib/utils"
import { reactiveOmit } from "@vueuse/core"
import {
  RangeCalendarHeadCell,
  type RangeCalendarHeadCellProps,
  useForwardProps,
} from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = defineProps<
  RangeCalendarHeadCellProps & { class?: HTMLAttributes["class"] }
>()

const delegatedProps = reactiveOmit(props, "class")

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <RangeCalendarHeadCell
    data-slot="range-calendar-head-cell"
    :class="
      cn(
        'text-muted-foreground w-8 rounded-md text-[0.8rem] font-normal',
        props.class
      )
    "
    v-bind="forwardedProps"
  >
    <slot />
  </RangeCalendarHeadCell>
</template>
