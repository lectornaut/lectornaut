<script setup lang="ts">
import { Button } from "@/components/ui/button"
import { IconArrowDown, IconArrowUp, IconChevronsUpDown } from "@/data/icons"

defineProps<{
  direction?: "asc" | "desc" | null
}>()
</script>

<template>
  <Button type="button" variant="ghost" class="-ml-3">
    <slot />
    <IconArrowUp v-if="direction === 'asc'" />
    <IconArrowDown v-else-if="direction === 'desc'" />
    <IconChevronsUpDown v-else />
  </Button>
</template>
