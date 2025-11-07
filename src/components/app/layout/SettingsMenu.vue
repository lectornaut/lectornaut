<script lang="ts" setup>
import emitter from "@/modules/mitt"
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem id="tour-help-support">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <SidebarMenuButton
              @click="emitter.emit('Dialog.Settings.Open', 'preferences')"
            >
              <icon-lucide-settings />
              Settings
            </SidebarMenuButton>
          </TooltipTrigger>
          <TooltipContent side="right" class="flex items-center gap-1 pr-2">
            Settings
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>,</Kbd>
            </KbdGroup>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
