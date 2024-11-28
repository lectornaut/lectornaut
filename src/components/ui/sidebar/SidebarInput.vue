<script setup lang="ts">
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <Input
    data-sidebar="input"
    :class="
      cn(
        'focus-visible:ring-sidebar-ring h-8 w-full bg-background shadow-none focus-visible:ring-2',
        props.class
      )
    "
  >
    <slot />
  </Input>
</template>
