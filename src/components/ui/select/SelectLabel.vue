<script lang="ts" setup>
import { cn } from "@/lib/utils"
import { SelectLabel, type SelectLabelProps } from "radix-vue"
import type { HTMLAttributes } from "vue"

const props = defineProps<
  SelectLabelProps & { class?: HTMLAttributes["class"] }
>()
</script>

<template>
  <SelectLabel
    :class="cn('py-1.5 pl-8 pr-2 text-xs font-semibold', props.class)"
  >
    <slot />
  </SelectLabel>
</template>
