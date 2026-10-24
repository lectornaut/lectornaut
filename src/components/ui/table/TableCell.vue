<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "cn"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <td
    data-slot="table-cell"
    :class="cn('p-3 align-middle whitespace-nowrap', props.class)"
  >
    <slot />
  </td>
</template>
