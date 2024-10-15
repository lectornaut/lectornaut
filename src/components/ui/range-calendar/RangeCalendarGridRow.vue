<script setup lang="ts">
import { cn } from "@/lib/utils"
import {
  RangeCalendarGridRow,
  type RangeCalendarGridRowProps,
  useForwardProps,
} from "radix-vue"
import { computed, type HTMLAttributes } from "vue"

const props = defineProps<
  RangeCalendarGridRowProps & { class?: HTMLAttributes["class"] }
>()

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props

  return delegated
})

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <RangeCalendarGridRow
    :class="cn('mt-2 flex w-full', props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </RangeCalendarGridRow>
</template>
