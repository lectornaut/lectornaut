<script setup lang="ts">
import { cn } from "@/lib/utils"
import { reactiveOmit } from "@vueuse/core"
import type { NavigationMenuLinkEmits, NavigationMenuLinkProps } from "reka-ui"
import { NavigationMenuLink, useForwardPropsEmits } from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = defineProps<
  NavigationMenuLinkProps & { class?: HTMLAttributes["class"] }
>()
const emits = defineEmits<NavigationMenuLinkEmits>()

const delegatedProps = reactiveOmit(props, "class")
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <NavigationMenuLink
    data-slot="navigation-menu-link"
    v-bind="forwarded"
    :class="
      cn(
        'data-[active=true]:focus:bg-muted data-[active=true]:hover:bg-muted data-[active=true]:bg-muted/50 focus-visible:ring-ring/30 hover:bg-muted focus:bg-muted flex items-center gap-1.5 rounded-3xl p-3 text-sm transition-all outline-none focus-visible:ring-3 focus-visible:outline-1 in-data-[slot=navigation-menu-content]:rounded-2xl [&_svg:not([class*=size-])]:size-4',
        props.class
      )
    "
  >
    <slot />
  </NavigationMenuLink>
</template>
