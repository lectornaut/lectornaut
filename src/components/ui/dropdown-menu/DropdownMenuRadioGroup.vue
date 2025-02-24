<script setup lang="ts">
import {
  DropdownMenuRadioGroup,
  type DropdownMenuRadioGroupEmits,
  type DropdownMenuRadioGroupProps,
  useForwardPropsEmits,
} from "reka-ui"

const props = defineProps<DropdownMenuRadioGroupProps>()
const emits = defineEmits<DropdownMenuRadioGroupEmits>()

const forwarded: ReturnType<typeof useForwardPropsEmits> = useForwardPropsEmits(
  props,
  emits
)
</script>

<template>
  <DropdownMenuRadioGroup v-bind="forwarded">
    <slot />
  </DropdownMenuRadioGroup>
</template>
