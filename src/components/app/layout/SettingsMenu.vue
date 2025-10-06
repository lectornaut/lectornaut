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
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>,</Kbd>
            </KbdGroup>
          </TooltipContent>
        </TooltipProvider>
      </Tooltip>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
