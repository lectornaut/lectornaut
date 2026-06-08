<script lang="ts" setup>
import { MoreHorizontalIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/vue"
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <span
    data-slot="breadcrumb-ellipsis"
    role="presentation"
    aria-hidden="true"
    :class="
      cn('flex size-5 items-center justify-center [&>svg]:size-4', props.class)
    "
  >
    <slot>
      <HugeiconsIcon :stroke-width="2" :icon="MoreHorizontalIcon" />
    </slot>
    <span class="sr-only">More</span>
  </span>
</template>
