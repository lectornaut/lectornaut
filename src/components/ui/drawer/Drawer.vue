<script lang="ts" setup>
import { useForwardPropsEmits } from "reka-ui"
import type { DrawerRootEmits, DrawerRootProps } from "vaul-vue"
import { DrawerRoot } from "vaul-vue"

const props = withDefaults(
  defineProps<Omit<DrawerRootProps, "fadeFromIndex">>(),
  {
    shouldScaleBackground: true,
  }
)

const emits = defineEmits<DrawerRootEmits>()

const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <DrawerRoot data-slot="drawer" v-bind="forwarded">
    <slot />
  </DrawerRoot>
</template>
