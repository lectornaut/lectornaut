<script setup lang="ts">
import {
  DropdownMenuRoot,
  type DropdownMenuRootEmits,
  type DropdownMenuRootProps,
  useForwardPropsEmits,
} from "reka-ui"

const props = defineProps<DropdownMenuRootProps>()
const emits = defineEmits<DropdownMenuRootEmits>()

const forwarded: ReturnType<typeof useForwardPropsEmits> = useForwardPropsEmits(
  props,
  emits
)
</script>

<template>
  <DropdownMenuRoot v-bind="forwarded">
    <slot />
  </DropdownMenuRoot>
</template>
