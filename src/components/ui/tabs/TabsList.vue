<script setup lang="ts">
import { cn } from "@/lib/utils"
import { reactiveOmit } from "@vueuse/core"
import type { TabsListProps } from "reka-ui"
import { TabsList } from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = withDefaults(
  defineProps<
    TabsListProps & {
      class?: HTMLAttributes["class"]
      variant?: "default" | "line"
    }
  >(),
  {
    variant: "default",
  }
)

const delegatedProps = reactiveOmit(props, "class", "variant")
</script>

<template>
  <TabsList
    data-slot="tabs-list"
    :data-variant="variant"
    v-bind="delegatedProps"
    :class="
      cn(
        'group/tabs-list text-muted-foreground inline-flex w-fit items-center justify-center rounded-lg p-[3px] group-data-horizontal/tabs:h-9 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none',
        variant === 'default' && 'bg-muted',
        variant === 'line' && 'gap-1 bg-transparent',
        props.class
      )
    "
  >
    <slot />
  </TabsList>
</template>
