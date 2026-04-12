<script setup lang="ts">
import { cn } from "@/lib/utils"
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <p
    data-slot="item-description"
    :class="
      cn(
        'text-muted-foreground [&>a:hover]:text-primary line-clamp-2 text-left text-sm font-normal [&>a]:underline [&>a]:underline-offset-4',
        props.class
      )
    "
  >
    <slot />
  </p>
</template>
