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
              size="xs"
              class="fixed bottom-3 left-3 rounded-full data-[state=open]:bg-muted"
            >
              <icon-lucide-circle-help />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right" class="flex items-center gap-2">
          Help and Support
          <span class="text-muted-foreground"> ? </span></TooltipContent
        >
        <DropdownMenuContent class="w-48" align="start" side="top">
          <DropdownMenuLabel> Help and Support </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem class="gap-2">
              <icon-lucide-message-circle />
              <span>Contact us</span>
            </DropdownMenuItem>
            <DropdownMenuItem class="gap-2">
              <icon-lucide-book-open />
              <span>Documentation</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              class="gap-2"
              @click="emitter.emit('Dialog.Shortcuts.Open')"
            >
              <icon-lucide-keyboard />
              <span>Keyboard shortcuts</span>
              <DropdownMenuShortcut>⌘ /</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem class="gap-2">
              <icon-lucide-twitter />
              <span>X (Twitter)</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </Tooltip>
  </TooltipProvider>
</template>
