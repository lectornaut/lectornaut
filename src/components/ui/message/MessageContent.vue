<script lang="ts" setup>
import type { PrimitiveProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { cn } from "cn"
import { Primitive } from "reka-ui"

interface Props extends PrimitiveProps {
  class?: HTMLAttributes["class"]
}
const props = withDefaults(defineProps<Props>(), {
  as: "div",
})
</script>

<template>
  <Primitive
    data-slot="message-content"
    :as="as"
    :as-child="asChild"
    :class="
      cn(
        'flex w-full min-w-0 flex-col gap-2.5 wrap-break-word group-data-[align=end]/message:*:data-slot:self-end',
        props.class
      )
    "
  >
    <slot />
  </Primitive>
</template>
