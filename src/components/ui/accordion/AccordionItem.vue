<script setup lang="ts">
import { cn } from "@/lib/utils"
import { reactiveOmit } from "@vueuse/core"
import type { AccordionItemProps } from "reka-ui"
import { AccordionItem, useForwardProps } from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = defineProps<
  AccordionItemProps & { class?: HTMLAttributes["class"] }
>()

const delegatedProps = reactiveOmit(props, "class")

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <AccordionItem
    v-slot="slotProps"
    data-slot="accordion-item"
    v-bind="forwardedProps"
    :class="cn('data-open:bg-muted/50 not-last:border-b', props.class)"
  >
    <slot v-bind="slotProps" />
  </AccordionItem>
</template>
