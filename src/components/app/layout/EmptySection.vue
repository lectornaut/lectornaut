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
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <Component :is="props.icon" class="size-6" />
      </EmptyMedia>
      <EmptyTitle class="font-medium">
        {{ props.title }}
      </EmptyTitle>
      <EmptyDescription>
        {{ props.description }}
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <Button v-if="props.actionText" variant="outline" @click="emit('action')">
        {{ props.actionText }}
      </Button>
    </EmptyContent>
  </Empty>
</template>
