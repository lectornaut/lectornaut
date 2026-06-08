<script setup lang="ts">
import { MinusSignIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/vue"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { useForwardProps } from "reka-ui"
import { cn } from "@/lib/utils"

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
      <HugeiconsIcon :stroke-width="2" :icon="MinusSignIcon" />
    </slot>
  </div>
</template>
