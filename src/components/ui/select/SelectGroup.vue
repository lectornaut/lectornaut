<script setup lang="ts">
import { cn } from "@/lib/utils"
import { reactiveOmit } from "@vueuse/core"
import type { SelectGroupProps } from "reka-ui"
import { SelectGroup } from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = defineProps<
  SelectGroupProps & { class?: HTMLAttributes["class"] }
>()

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <SelectGroup
    data-slot="select-group"
    v-bind="delegatedProps"
    :class="cn('scroll-my-1.5 p-1.5', props.class)"
  >
    <slot />
  </SelectGroup>
</template>
