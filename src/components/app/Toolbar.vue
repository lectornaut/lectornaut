<script setup lang="ts">
import { isTauri } from "@/helpers/utilities"

const leftSidebarVisibility = useStorage("leftSidebarVisibility", true)
</script>

<template>
  <div data-tauri-drag-region class="flex items-center justify-between p-2">
    <div class="flex items-center gap-2" :class="{ 'pl-16': isTauri }">
      <Button
        v-if="!leftSidebarVisibility"
        v-motion-fade
        variant="ghost"
        size="xs"
        @click="leftSidebarVisibility = true"
      >
        <icon-lucide-chevrons-right />
      </Button>
    </div>
    <div class="flex items-center gap-2">
      <ColorMode />
      <ExitTrigger
        ><Button size="xs" variant="secondary">Logout</Button></ExitTrigger
      >
    </div>
  </div>
</template>
