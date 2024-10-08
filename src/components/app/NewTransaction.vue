<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button size="sm" class="gap-2">
        <icon-lucide-plus />
        New Transaction
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent class="w-56" align="end">
      <DropdownMenuLabel>New Transaction</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem class="gap-3">
          <icon-lucide-dollar-sign />
          <span>Balance</span>
          <DropdownMenuShortcut>⌘ ⇧ B</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem class="gap-3">
          <icon-lucide-arrow-down-left />
          <span>Income</span>
          <DropdownMenuShortcut>⌘ ⇧ I</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem class="gap-3">
          <icon-lucide-arrow-up-right />
          <span>Expense</span>
          <DropdownMenuShortcut>⌘ ⇧ E</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem class="gap-3">
          <icon-lucide-arrow-left-right />
          <span>Transfer</span>
          <DropdownMenuShortcut>⌘ ⇧ T</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
