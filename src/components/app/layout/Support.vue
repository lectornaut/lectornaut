<script setup lang="ts">
import emitter from "@/modules/mitt"

const openSupport = ref(false)

emitter.on("Menu.Help.Toggle", () => {
  openSupport.value = !openSupport.value
})
</script>

<template>
  <TooltipProvider>
    <Tooltip>
      <DropdownMenu v-model:open="openSupport">
        <TooltipTrigger as-child>
          <DropdownMenuTrigger as-child>
            <Button
              variant="outline"
              size="icon"
              class="data-[state=open]:bg-muted fixed bottom-3 left-3 rounded-full"
            >
              <icon-lucide-circle-help />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right" class="flex items-center gap-2">
          Help and Support
          <span class="text-muted-foreground"> ? </span></TooltipContent
        >
        <DropdownMenuContent align="start">
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
</template>
