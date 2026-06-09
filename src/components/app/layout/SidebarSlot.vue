<script lang="ts" setup>
import { useSidebarSlot } from "@/composables/useSidebarSlots"

// Drop-in replacement for `<Teleport defer to="#left-sidebar">`: pages teleport
// their left/right sidebar content through here so the target can be repointed
// at the hover-card preview while a collapsed panel is being peeked. See
// useSidebarSlots for the mechanism.
const props = defineProps<{ side: "left" | "right" }>()

const { target } = useSidebarSlot(props.side)
</script>

<template>
  <Teleport defer :to="target">
    <slot />
  </Teleport>
</template>
