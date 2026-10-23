<script setup lang="ts">
import type { CollapsibleContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { cn } from "cn"
import { CollapsibleContent } from "@/components/ui/collapsible"

const props = defineProps<
  CollapsibleContentProps & { class?: HTMLAttributes["class"] }
>()

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <CollapsibleContent
    data-slot="trace-collapsible-content"
    v-bind="delegatedProps"
    class="data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down min-w-0 overflow-hidden duration-200"
  >
    <div
      data-slot="trace-collapsible-content-inner"
      :class="
        cn(
          'text-muted-foreground mt-2.5 mb-1 ml-[calc(--spacing(2)-1px)] min-w-0 border-l pr-1 pl-4 leading-relaxed wrap-break-word',
          props.class
        )
      "
    >
      <slot />
    </div>
  </CollapsibleContent>
</template>
