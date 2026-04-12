<script setup lang="ts">
import { cn } from "@/lib/utils"
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="item-content"
    :class="
      cn(
        'flex flex-1 flex-col gap-1 group-data-[size=xs]/item:gap-0.5 [&+[data-slot=item-content]]:flex-none',
        props.class
      )
    "
  >
    <slot />
  </div>
</template>
