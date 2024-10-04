<template>
  <ScrollArea>
    <div class="space-y-8">
      <div class="flex items-center gap-4">
        <span
          class="flex h-9 w-9 items-center justify-center rounded border bg-muted"
        >
          <icon-lucide-car class="h-4 w-4" />
        </span>
        <div class="flex grow flex-col gap-2">
          <div class="flex items-center justify-between">
            <p class="text-sm font-medium leading-none">Buy a new car</p>
            <p class="flex items-center gap-2 text-muted-foreground">
              <icon-lucide-history /> <span>21 days left</span>
            </p>
          </div>
          <Progress :model-value="87" class="h-2 w-full" />
          <div class="font-geist font-medium">
            $1,88,999.00
            <span class="text-muted-foreground">of $2,00,000.00</span>
          </div>
        </div>
      </div>
    </div>
  </ScrollArea>
</template>
