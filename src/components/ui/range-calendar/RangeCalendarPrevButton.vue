<script lang="ts" setup>
import type { RangeCalendarPrevProps } from "reka-ui"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { reactiveOmit } from "@vueuse/core"
import { ChevronLeftIcon } from "lucide-vue-next"
import { RangeCalendarPrev, useForwardProps } from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = defineProps<
  RangeCalendarPrevProps & { class?: HTMLAttributes["class"] }
>()

const delegatedProps = reactiveOmit(props, "class")

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <RangeCalendarPrev
    data-slot="range-calendar-prev-button"
    :class="
      cn(
        buttonVariants({ variant: 'outline' }),
        'absolute left-1',
        'size-7 bg-transparent p-0 opacity-50 hover:opacity-100',
        props.class
      )
    "
    v-bind="forwardedProps"
  >
    <slot>
      <ChevronLeftIcon class="size-4" />
    </slot>
  </RangeCalendarPrev>
</template>
