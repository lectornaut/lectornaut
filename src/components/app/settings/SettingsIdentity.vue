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
    <ItemTitle class="w-full min-w-0 flex-wrap">
      <span
        :title="title"
        class="min-w-0 grow basis-32 truncate"
        :class="{ 'font-mono': monospace }"
      >
        {{ title }}
      </span>
      <slot name="badges" />
    </ItemTitle>
    <ItemDescription
      v-if="description"
      :title="description"
      class="text-xs wrap-anywhere whitespace-normal"
    >
      {{ description }}
    </ItemDescription>
  </ItemContent>
</template>
