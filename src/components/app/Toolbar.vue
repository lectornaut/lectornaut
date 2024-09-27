<script setup lang="ts">
import { isTauri } from "@/helpers/utilities"
import { leftSidebarVisibility } from "@/modules/theme"
</script>

<template>
  <div
    data-tauri-drag-region
    class="flex items-center justify-between gap-2 p-4"
  >
    <div
      class="flex grow items-center gap-2"
      :class="{ 'pl-16': !leftSidebarVisibility && isTauri }"
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              v-if="!leftSidebarVisibility"
              v-motion-fade
              variant="ghost"
              size="xs"
              @click="leftSidebarVisibility = true"
            >
              <icon-lucide-chevrons-right />
            </Button>
          </TooltipTrigger>
          <TooltipContent> Expand Sidebar </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <CommandK />
    </div>
    <div class="flex items-center gap-2">
      <ColorMode />
      <ExitTrigger
        ><Button size="xs" variant="secondary">Logout</Button></ExitTrigger
      >
    </div>
  </div>
</template>
