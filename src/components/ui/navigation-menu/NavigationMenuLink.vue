<script setup lang="ts">
import {
  NavigationMenuLink,
  type NavigationMenuLinkEmits,
  type NavigationMenuLinkProps,
  useForwardPropsEmits,
} from "reka-ui"

const props = defineProps<NavigationMenuLinkProps>()
const emits = defineEmits<NavigationMenuLinkEmits>()

const forwarded: ReturnType<typeof useForwardPropsEmits> = useForwardPropsEmits(
  props,
  emits
)
</script>

<template>
  <NavigationMenuLink v-bind="forwarded">
    <slot />
  </NavigationMenuLink>
</template>
