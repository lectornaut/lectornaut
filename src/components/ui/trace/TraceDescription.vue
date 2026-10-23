<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "cn"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <span
    data-slot="trace-description"
    :class="cn('text-muted-foreground/70 shrink-0 tabular-nums', props.class)"
  >
    <slot />
  </span>
</template>
