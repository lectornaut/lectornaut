<script setup lang="ts">
import type { HTMLAttributes } from "vue"

import { cn } from "@/lib/utils"
import { reactiveOmit } from "@vueuse/core"
import { MinusIcon } from "lucide-vue-next"
import { useForwardProps } from "reka-ui"

const props = defineProps<{ class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")
const forwarded = useForwardProps(delegatedProps)
</script>

<template>
  <div
    data-slot="input-otp-separator"
    role="separator"
    v-bind="forwarded"
    :class="
      cn('flex items-center [&_svg:not([class*=size-])]:size-4', props.class)
    "
  >
    <slot>
      <MinusIcon />
    </slot>
  </div>
</template>
