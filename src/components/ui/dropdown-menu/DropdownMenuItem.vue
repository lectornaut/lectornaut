<script setup lang="ts">
import { cn } from "@/lib/utils"
import { reactiveOmit } from "@vueuse/core"
import type { DropdownMenuItemProps } from "reka-ui"
import { DropdownMenuItem, useForwardProps } from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = withDefaults(
  defineProps<
    DropdownMenuItemProps & {
      class?: HTMLAttributes["class"]
      inset?: boolean
      variant?: "default" | "destructive"
    }
  >(),
  {
    variant: "default",
  }
)

const delegatedProps = reactiveOmit(props, "inset", "variant", "class")

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <DropdownMenuItem
    data-slot="dropdown-menu-item"
    :data-inset="inset ? '' : undefined"
    :data-variant="variant"
    v-bind="forwardedProps"
    :class="
      cn(
        'focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:text-destructive not-data-[variant=destructive]:focus:**:text-accent-foreground group/dropdown-menu-item relative flex cursor-default items-center gap-2.5 rounded-2xl px-3 py-2 text-sm font-medium outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-inset:pl-9.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
        props.class
      )
    "
  >
    <slot />
  </DropdownMenuItem>
</template>
