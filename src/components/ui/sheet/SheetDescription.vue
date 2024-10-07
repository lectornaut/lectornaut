<script lang="ts" setup>
import { cn } from "@/lib/utils"
import { DialogDescription, type DialogDescriptionProps } from "radix-vue"
import { type HTMLAttributes, computed } from "vue"

const props = defineProps<
  DialogDescriptionProps & { class?: HTMLAttributes["class"] }
>()

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props

  return delegated
})
</script>

<template>
  <DialogDescription
    :class="cn('text-xs text-muted-foreground', props.class)"
    v-bind="delegatedProps"
  >
    <slot />
  </DialogDescription>
</template>
