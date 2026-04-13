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
    <div class="bg-secondary mx-3 mb-3">
      <div class="p-2">
        <Badge variant="secondary" size="icon-xs" class="text-muted-foreground">
          <IconAiFill />
        </Badge>
      </div>
      <AiChatComposer :placeholder="placeholder" :usage-label="usageLabel" />
    </div>
  </OverlayScrollbarsWrapper>
</template>
