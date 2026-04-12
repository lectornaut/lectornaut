<!-- @fallthroughAttributes true -->
<!-- @strictTemplates true -->

<script setup lang="ts">
import { cn } from "@/lib/utils"
import type { HTMLAttributes } from "vue"

const props = defineProps<{ class?: HTMLAttributes["class"] }>()
</script>

<template>
  <optgroup
    v-bind="{ 'data-slot': 'native-select-optgroup' }"
    :class="cn(props.class)"
  >
    <slot />
  </optgroup>
</template>
