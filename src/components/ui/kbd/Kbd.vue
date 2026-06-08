<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <kbd
    data-slot="kbd"
    :class="
      cn(
        'bg-muted text-muted-foreground in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 in-data-[slot=input-group]:bg-input pointer-events-none inline-flex h-5.5 w-fit min-w-5.5 items-center justify-center gap-1 rounded-lg px-1.5 font-sans text-xs font-medium select-none [&_svg:not([class*=size-])]:size-3',
        props.class
      )
    "
  >
    <slot />
  </kbd>
</template>
