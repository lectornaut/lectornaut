<script setup lang="ts">
import { cn } from "@/lib/utils"
import { reactiveOmit } from "@vueuse/core"
import type { DialogTitleProps } from "reka-ui"
import { DialogTitle } from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = defineProps<
  DialogTitleProps & { class?: HTMLAttributes["class"] }
>()

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <DialogTitle
    data-slot="sheet-title"
    :class="
      cn('text-foreground cn-font-heading text-sm font-medium', props.class)
    "
    v-bind="delegatedProps"
  >
    <slot />
  </DialogTitle>
</template>
