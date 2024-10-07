<script lang="ts" setup>
import { cn } from "@/lib/utils"
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <caption :class="cn('mt-4 text-xs text-muted-foreground', props.class)">
    <slot />
  </caption>
</template>
