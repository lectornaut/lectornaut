<script lang="ts" setup>
import { IconAiFill } from "@/data/icons"

defineProps<{
  placeholder?: string
  usageLabel?: string
}>()
</script>

<template>
  <div class="flex h-full min-h-0 min-w-0 grow flex-col">
    <div class="min-h-0 min-w-0 grow">
      <AiChat />
    </div>
    <div class="bg-secondary mx-2 mb-2 rounded-lg border p-0.5">
      <div class="py-0.5">
        <Badge
          variant="secondary"
          size="icon-xs"
          class="text-muted-foreground/50"
        >
          <IconAiFill />
        </Badge>
      </div>
      <AiChatComposer :placeholder="placeholder" :usage-label="usageLabel" />
    </div>
  </div>
</template>
