<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"

// Global loading state. Renders the canonical Empty + Spinner UI so every
// page/section/region loader looks identical. Use this instead of a bare
// <Spinner /> for region loaders; keep inline <Spinner /> for button/badge
// pending states (those aren't empty-state loaders).
const props = defineProps<{
  class?: HTMLAttributes["class"]
  /** Optional loading label (rendered as the title). Default slot overrides. */
  label?: string
  /** Optional secondary description line. */
  description?: string
}>()
</script>

<template>
  <Empty :class="props.class">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <Spinner />
      </EmptyMedia>
      <EmptyTitle v-if="label || $slots.default">
        <slot>{{ label }}</slot>
      </EmptyTitle>
      <EmptyDescription v-if="description">
        {{ description }}
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
</template>
