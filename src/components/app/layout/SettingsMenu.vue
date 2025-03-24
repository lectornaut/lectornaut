<script setup lang="ts">
import emitter from "@/modules/mitt"
</script>

<template>
  <SidebarMenuItem>
    <TooltipProvider>
      <Tooltip>
        <DropdownMenu>
          <TooltipTrigger as-child>
            <DropdownMenuTrigger as-child>
              <SidebarMenuButton class="data-[state=open]:bg-muted">
                <icon-lucide-bolt />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
          <DropdownMenuContent class="w-48" align="end" side="right">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem class="gap-2">
                <icon-lucide-user />
                <span>Profile</span>
                <DropdownMenuShortcut>⇧ ⌘ P</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                class="gap-2"
                @click="emitter.emit('Dialog.Settings.Open')"
              >
                <icon-lucide-settings />
                <span>Preferences</span>
                <DropdownMenuShortcut>⌘ ,</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                class="gap-2"
                @click="emitter.emit('Dialog.Exit.Open')"
              >
                <icon-lucide-log-out />
                <span>Logout</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </Tooltip>
    </TooltipProvider>
  </SidebarMenuItem>
</template>
