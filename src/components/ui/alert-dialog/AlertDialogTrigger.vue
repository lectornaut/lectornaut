<script lang="ts" setup>
import { AlertDialogTrigger, type AlertDialogTriggerProps } from "radix-vue"

const props = defineProps<AlertDialogTriggerProps>()
</script>

<template>
  <AlertDialogTrigger v-bind="props">
    <slot />
  </AlertDialogTrigger>
</template>
