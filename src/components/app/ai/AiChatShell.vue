<script lang="ts" setup>
import { IconAiFill } from "@/data/icons"

defineProps<{
  placeholder?: string
  usageLabel?: string
}>()
</script>

<template>
  <OverlayScrollbarsWrapper>
    <AiChat />
    <div class="bg-secondary mx-2 mb-2 rounded-3xl">
      <div class="p-1">
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
  </OverlayScrollbarsWrapper>
</template>
