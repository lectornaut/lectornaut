<script setup lang="ts">
import { ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"

defineProps<{
  title: string
  description?: string | null
  monospace?: boolean
}>()
</script>

<template>
  <ItemContent class="min-w-0 group-data-[size=xs]/item:max-w-md">
    <!-- Badges sit right after the name (not pushed to the far edge); the name
       truncates first since Badge is shrink-0. -->
    <ItemTitle class="w-full min-w-0 flex-nowrap">
      <span
        :title="title"
        class="min-w-0 truncate"
        :class="{ 'font-mono': monospace }"
      >
        {{ title }}
      </span>
      <slot name="badges" />
    </ItemTitle>
    <ItemDescription
      v-if="description"
      :title="description"
      class="line-clamp-1 text-xs wrap-anywhere whitespace-normal"
    >
      {{ description }}
    </ItemDescription>
  </ItemContent>
</template>
