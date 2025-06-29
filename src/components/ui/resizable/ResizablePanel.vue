<script setup lang="ts">
import type { SplitterPanelEmits, SplitterPanelProps } from "reka-ui"
import { SplitterPanel, useForwardPropsEmits } from "reka-ui"

const props = defineProps<SplitterPanelProps>()
const emits = defineEmits<SplitterPanelEmits>()

const forwarded = useForwardPropsEmits(props, emits)
const splitterPanelRef = ref<InstanceType<typeof SplitterPanel>>()

defineExpose({
  splitterPanel: splitterPanelRef,
})
</script>

<template>
  <SplitterPanel
    ref="splitterPanelRef"
    data-slot="resizable-panel"
    v-bind="forwarded"
  >
    <slot />
  </SplitterPanel>
</template>
