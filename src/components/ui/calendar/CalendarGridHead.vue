<script setup lang="ts">
import { CalendarGridHead, type CalendarGridHeadProps } from "radix-vue"

const props = defineProps<CalendarGridHeadProps>()
</script>

<template>
  <CalendarGridHead v-bind="props">
    <slot />
  </CalendarGridHead>
</template>
