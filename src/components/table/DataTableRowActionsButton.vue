<script setup lang="ts">
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { IconMoreHorizontal } from "@/data/icons"

defineProps<{
  label: string
  disabled?: boolean
  loading?: boolean
}>()
</script>

<template>
  <Button
    type="button"
    variant="outline"
    size="icon-lg"
    class="data-[state=open]:bg-accent"
    :aria-label="label"
    :aria-busy="loading || undefined"
    :disabled="disabled || loading"
    @click.stop
  >
    <Spinner v-if="loading" />
    <IconMoreHorizontal v-else />
  </Button>
</template>
