<script lang="ts" setup>
import type { TagsInputItemProps } from "reka-ui"
import type { HTMLAttributes } from "vue"

import { cn } from "@/lib/utils"
import { reactiveOmit } from "@vueuse/core"
import { TagsInputItem, useForwardProps } from "reka-ui"

const props = defineProps<
  TagsInputItemProps & { class?: HTMLAttributes["class"] }
>()

const delegatedProps = reactiveOmit(props, "class")

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <TagsInputItem
    v-bind="forwardedProps"
    :class="
      cn(
        'bg-secondary data-[state=active]:ring-ring ring-offset-background flex h-5 items-center rounded-md data-[state=active]:ring-2 data-[state=active]:ring-offset-2',
        props.class
      )
    "
  >
    <slot />
  </TagsInputItem>
</template>
