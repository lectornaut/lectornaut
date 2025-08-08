<script setup lang="ts">
import emitter from "@/modules/mitt"
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem id="tour-help-support">
      <Tooltip>
        <TooltipProvider>
          <TooltipTrigger as-child>
            <SidebarMenuButton
              @click="emitter.emit('Dialog.Settings.Open', 'preferences')"
            >
              <icon-lucide-settings />
              Settings
            </SidebarMenuButton>
          </TooltipTrigger>
          <TooltipContent side="right" class="flex items-center gap-1 pr-2">
            Help and Support
            <kbd class="shortcut-key">⌘</kbd>
            <kbd class="shortcut-key">,</kbd>
          </TooltipContent>
        </TooltipProvider>
      </Tooltip>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
