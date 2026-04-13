<script setup lang="ts">
import { cn } from "@/lib/utils"
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="card-footer"
    :class="
      cn(
        'flex items-center rounded-none border-t p-4 group-data-[size=sm]/card:p-3',
        props.class
      )
    "
  >
    <slot />
  </div>
</template>
