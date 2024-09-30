<script setup lang="ts">
import { isTauri } from "@/helpers/utilities"
import emitter from "@/modules/mitt"
import { leftSidebarVisibility, rightSidebarVisibility } from "@/modules/theme"
</script>

<template>
  <div
    data-tauri-drag-region
    class="sticky top-0 z-10 flex items-center justify-between gap-2 border-b p-2"
    :class="{ 'pl-20': !leftSidebarVisibility && isTauri }"
  >
    <span class="flex items-center gap-2">
      <TooltipProvider v-if="!leftSidebarVisibility">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              v-motion-fade
              variant="ghost"
              size="xs"
              @click="emitter.emit('Sidebar.Left.Toggle')"
            >
              <icon-lucide-panel-left />
            </Button>
          </TooltipTrigger>
          <TooltipContent> Expand Sidebar </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <CommandK />
    </span>
    <span class="flex items-center gap-2">
      <ColorMode />
      <ExitTrigger>
        <Button size="xs" variant="ghost">Logout</Button>
      </ExitTrigger>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              v-motion-fade
              variant="ghost"
              size="xs"
              @click="emitter.emit('Sidebar.Right.Toggle')"
            >
              <icon-mingcute-ai-fill v-if="rightSidebarVisibility" />
              <icon-mingcute-ai-line v-else />
            </Button>
          </TooltipTrigger>
          <TooltipContent> Expand Sidebar </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  </div>
</template>
