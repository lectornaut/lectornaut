<script setup lang="ts">
import emitter from "@/modules/mitt"

const openSupport = ref(false)

emitter.on("Menu.Help.Toggle", () => {
  openSupport.value = !openSupport.value
})
</script>

<template>
  <SidebarMenuItem>
    <TooltipProvider>
      <Tooltip>
        <DropdownMenu v-model:open="openSupport">
          <TooltipTrigger as-child>
            <DropdownMenuTrigger as-child>
              <SidebarMenuButton class="data-[state=open]:bg-accent">
                <icon-lucide-circle-help />
                <span class="truncate">Help & Support</span>
              </SidebarMenuButton>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right" class="flex items-center gap-2">
            Help and Support
            <kbd class="shortcut-key">?</kbd>
          </TooltipContent>
          <DropdownMenuContent class="w-56" align="end" side="right">
            <DropdownMenuLabel>Help and Support</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem class="gap-2">
                <icon-lucide-message-circle />
                <span class="truncate">Contact us</span>
              </DropdownMenuItem>
              <DropdownMenuItem class="gap-2">
                <icon-lucide-book-open />
                <span class="truncate">Documentation</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                class="gap-2"
                @click="emitter.emit('Dialog.Shortcuts.Open')"
              >
                <icon-lucide-keyboard />
                <span class="truncate">Keyboard shortcuts</span>
                <DropdownMenuShortcut>⌘ /</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem class="gap-2">
                <icon-lucide-twitter />
                <span class="truncate">X (Twitter)</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </Tooltip>
    </TooltipProvider>
  </SidebarMenuItem>
</template>
