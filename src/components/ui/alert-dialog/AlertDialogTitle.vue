<script setup lang="ts">
import { cn } from "@/lib/utils"
import { reactiveOmit } from "@vueuse/core"
import type { AlertDialogTitleProps } from "reka-ui"
import { AlertDialogTitle } from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = defineProps<
  AlertDialogTitleProps & { class?: HTMLAttributes["class"] }
>()

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <AlertDialogTitle
    data-slot="alert-dialog-title"
    v-bind="delegatedProps"
    :class="
      cn(
        'cn-font-heading text-sm font-medium sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2',
        props.class
      )
    "
  >
    <slot />
  </AlertDialogTitle>
</template>
