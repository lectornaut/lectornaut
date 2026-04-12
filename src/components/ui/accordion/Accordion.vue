<script setup lang="ts">
import { cn } from "@/lib/utils"
import { reactiveOmit } from "@vueuse/core"
import type { AccordionRootEmits, AccordionRootProps } from "reka-ui"
import { AccordionRoot, useForwardPropsEmits } from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = defineProps<
  AccordionRootProps & { class?: HTMLAttributes["class"] }
>()
const emits = defineEmits<AccordionRootEmits>()

const delegatedProps = reactiveOmit(props, "class")
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <AccordionRoot
    v-slot="slotProps"
    data-slot="accordion"
    v-bind="forwarded"
    :class="
      cn('flex w-full flex-col overflow-hidden rounded-2xl border', props.class)
    "
  >
    <slot v-bind="slotProps" />
  </AccordionRoot>
</template>
