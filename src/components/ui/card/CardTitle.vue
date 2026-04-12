<script setup lang="ts">
import { cn } from "@/lib/utils"
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="card-title"
    :class="cn('cn-font-heading text-base font-medium', props.class)"
  >
    <slot />
  </div>
</template>
