<script setup lang="ts">
import { menu } from "@/helpers/defaults"
</script>

<template>
  <div
    class="mx-auto grid w-full max-w-5xl grid-cols-1 gap-2 p-2 md:grid-cols-2"
  >
    <Button
      v-for="(item, itemIdx) in menu"
      :key="itemIdx"
      variant="ghost"
      class="flex h-auto flex-1 grow justify-start gap-4 p-2"
    >
      <div
        :class="[
          item.color,
          'text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded',
        ]"
      >
        <Component :is="item.icon" class="size-4" />
      </div>
      <div class="grid grid-cols-1 text-left">
        <h3 class="font-medium">
          {{ item.action }}
        </h3>
        <p class="text-secondary-foreground truncate text-xs">
          {{ item.description }}
        </p>
      </div>
    </Button>
  </div>
</template>
