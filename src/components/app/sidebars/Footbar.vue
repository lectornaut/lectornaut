<script setup lang="ts">
import emitter from "@/modules/mitt"
</script>

<template>
  <div
    data-tauri-drag-region
    class="pb-safe-bottom grid shrink-0 grid-cols-3 gap-2"
  >
    <div class="flex items-center justify-start" data-tauri-drag-region>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="rounded-none"
              @click="emitter.emit('Sidebar.Left.Toggle')"
            >
              <icon-lucide-panel-left />
            </Button>
          </TooltipTrigger>
          <TooltipContent> Left panel </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
    <div class="flex items-center justify-center" data-tauri-drag-region></div>
    <div class="flex items-center justify-end" data-tauri-drag-region>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="rounded-none"
              @click="emitter.emit('Sidebar.Right.Toggle')"
            >
              <icon-lucide-panel-right />
            </Button>
          </TooltipTrigger>
          <TooltipContent> Right panel </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  </div>
</template>
