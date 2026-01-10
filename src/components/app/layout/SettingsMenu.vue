<script lang="ts" setup>
import { IconSettings } from "@/data/icons"
import { emitter } from "@/modules/mitt"
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem id="tour-help-support">
      <SidebarMenuButton
        tooltip="Settings"
        @click="emitter.emit('Dialog.Settings.Open', 'preferences')"
      >
        <IconSettings />
        Settings
      </SidebarMenuButton>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
