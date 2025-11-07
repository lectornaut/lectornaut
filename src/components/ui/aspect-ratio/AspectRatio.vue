<script lang="ts" setup>
import type { AspectRatioProps } from "reka-ui"
import { AspectRatio } from "reka-ui"

const props = defineProps<AspectRatioProps>()
</script>

<template>
  <AspectRatio data-slot="aspect-ratio" v-bind="props">
    <slot />
  </AspectRatio>
</template>
