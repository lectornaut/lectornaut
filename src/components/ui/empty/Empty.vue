<script setup lang="ts">
import { cn } from "@/lib/utils"
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="empty"
    :class="
      cn(
        'flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-2xl border-dashed p-12 text-center text-balance',
        props.class
      )
    "
  >
    <slot />
  </div>
</template>
