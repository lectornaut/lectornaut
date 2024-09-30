<script lang="ts" setup>
import { useFormField } from "./useFormField"
import { cn } from "@/lib/utils"
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()

const { formDescriptionId } = useFormField()
</script>

<template>
  <p
    :id="formDescriptionId"
    :class="cn('text-xs text-muted-foreground', props.class)"
  >
    <slot />
  </p>
</template>
