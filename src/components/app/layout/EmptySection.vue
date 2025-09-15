<script setup lang="ts">
import type { FunctionalComponent, SVGAttributes } from "vue"

const props = defineProps<{
  centered?: boolean
  icon: FunctionalComponent<SVGAttributes>
  title: string
  description: string
  actionText?: string
}>()

const emit = defineEmits<{
  (e: "action"): void
}>()
</script>

<template>
  <div
    class="flex size-full flex-col items-center"
    :class="{ 'justify-center': props.centered }"
  >
    <div
      class="flex max-w-xs flex-col items-center justify-center gap-4 p-8 text-center"
    >
      <Component
        :is="props.icon"
        class="size-16 rounded-lg border border-dashed p-4"
      />
      <h3 class="font-medium">
        {{ props.title }}
      </h3>
      <p class="text-muted-foreground text-xs text-balance">
        {{ props.description }}
      </p>
      <Button v-if="props.actionText" variant="outline" @click="emit('action')">
        {{ props.actionText }}
      </Button>
    </div>
  </div>
</template>
