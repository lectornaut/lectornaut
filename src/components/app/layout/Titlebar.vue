<template>
  <header class="flex min-h-titlebar-height items-center justify-center">
    <div
      data-tauri-drag-region
      class="grid h-full min-h-7 w-full grid-cols-3 items-center gap-2 p-2"
    >
      <div
        data-tauri-drag-region
        class="flex grow items-center justify-end gap-2"
      >
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon" class="gap-2">
                <icon-lucide-arrow-left />
              </Button>
            </TooltipTrigger>
            <TooltipContent> Go back </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon" class="gap-2">
                <icon-lucide-arrow-right />
              </Button>
            </TooltipTrigger>
            <TooltipContent> Go forward </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div
        data-tauri-drag-region
        class="flex grow items-center justify-center gap-2"
      >
        <CommandK />
      </div>
      <div
        data-tauri-drag-region
        class="flex grow items-center justify-start gap-2"
      >
        <TasksNotifications />
      </div>
    </div>
    <Settings />
    <Shortcuts />
    <ExitTrigger />
  </header>
</template>
