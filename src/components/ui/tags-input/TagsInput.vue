<script setup lang="ts">
import { cn } from "@/lib/utils"
import { reactiveOmit } from "@vueuse/core"
import type { TagsInputRootEmits, TagsInputRootProps } from "reka-ui"
import { TagsInputRoot, useForwardPropsEmits } from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = defineProps<
  TagsInputRootProps & { class?: HTMLAttributes["class"] }
>()
const emits = defineEmits<TagsInputRootEmits>()

const delegatedProps = reactiveOmit(props, "class")

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <TagsInputRoot
    v-slot="slotProps"
    v-bind="forwarded"
    :class="
      cn(
        'border-input bg-background flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5 text-sm',
        props.class
      )
    "
  >
    <slot v-bind="slotProps" />
  </TagsInputRoot>
</template>
