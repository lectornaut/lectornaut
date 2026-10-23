<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "cn"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <span
    data-slot="trace-icon"
    aria-hidden="true"
    :class="
      cn(
        'flex size-4 shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg:not([class*=\'size-\'])]:size-4 [[data-slot=trace-title]~&]:-ml-1',
        props.class
      )
    "
  >
    <slot />
  </span>
</template>
