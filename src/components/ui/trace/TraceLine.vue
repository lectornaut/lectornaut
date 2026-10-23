<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "cn"

const props = defineProps<{
  status?: "running" | "error" | "pending"
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <span
    data-slot="trace-line"
    :data-status="status"
    :class="
      cn(
        'text-muted-foreground in-[a:hover,button:hover]:text-foreground data-[status=error]:text-destructive data-[status=error]:in-[a:hover,button:hover]:text-destructive data-[status=running]:*:data-[slot=trace-title]:shimmer flex w-fit max-w-full min-w-0 items-center gap-2 text-sm transition-colors in-[a,button]:cursor-pointer data-[status=pending]:opacity-60',
        props.class
      )
    "
  >
    <slot />
  </span>
</template>
