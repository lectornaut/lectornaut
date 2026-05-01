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
    <div class="bg-muted mx-3 mb-3 rounded p-0.5">
      <Badge variant="ghost" size="icon-xs" class="text-muted-foreground">
        <IconAiFill />
      </Badge>
      <AiChatComposer :placeholder="placeholder" :usage-label="usageLabel" />
    </div>
  </OverlayScrollbarsWrapper>
</template>
