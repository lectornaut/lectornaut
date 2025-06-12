<template>
  <div class="pb-safe-bottom grid h-5 shrink-0 grid-cols-3 gap-2">
    <div class="flex items-center justify-start"></div>
    <div class="flex items-center justify-center"></div>
    <div class="flex items-center justify-end">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="text-secondary-foreground aspect-square size-auto h-full rounded-none p-0"
            >
              <icon-lucide-panel-left class="!size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent> Left panel </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="text-secondary-foreground aspect-square size-auto h-full rounded-none p-0"
            >
              <icon-lucide-panel-bottom class="!size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent> Bottom panel </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="text-secondary-foreground aspect-square size-auto h-full rounded-none p-0"
            >
              <icon-lucide-panel-right class="!size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent> Right panel </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  </div>
</template>
