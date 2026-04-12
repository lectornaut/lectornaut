<script setup lang="ts">
import { cn } from "@/lib/utils"
import { reactiveOmit } from "@vueuse/core"
import type { DropdownMenuSeparatorProps } from "reka-ui"
import { DropdownMenuSeparator } from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = defineProps<
  DropdownMenuSeparatorProps & {
    class?: HTMLAttributes["class"]
  }
>()

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <DropdownMenuSeparator
    data-slot="dropdown-menu-separator"
    v-bind="delegatedProps"
    :class="cn('bg-border/50 -mx-1.5 my-1.5 h-px', props.class)"
  />
</template>
