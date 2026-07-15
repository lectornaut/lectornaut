<script setup lang="ts">
import type { TagsInputItemDeleteProps } from "reka-ui"

import type { HTMLAttributes } from "vue"
import { XIcon } from "@lucide/vue"
import { reactiveOmit } from "@vueuse/core"
import { TagsInputItemDelete, useForwardProps } from "reka-ui"
import { cn } from "@/lib/utils"

const props = defineProps<
  TagsInputItemDeleteProps & { class?: HTMLAttributes["class"] }
>()

const delegatedProps = reactiveOmit(props, "class")

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <TagsInputItemDelete
    v-bind="forwardedProps"
    :class="cn('mr-1 flex rounded bg-transparent', props.class)"
  >
    <slot>
      <XIcon class="h-4 w-4" />
    </slot>
  </TagsInputItemDelete>
</template>
