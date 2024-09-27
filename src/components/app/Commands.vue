<template>
  <CommandList>
    <CommandEmpty>No results found.</CommandEmpty>
    <CommandGroup heading="Suggestions">
      <CommandItem value="calendar" class="grow justify-start gap-3 truncate"
        ><icon-lucide-circle-dot class="h-4 w-4" /><span class="truncate"
          >Calendar</span
        >
      </CommandItem>
      <CommandItem
        value="search-emoji"
        class="grow justify-start gap-3 truncate"
        ><icon-lucide-circle-dot class="h-4 w-4" /><span class="truncate"
          >Search Emoji</span
        >
      </CommandItem>
      <CommandItem value="calculator" class="grow justify-start gap-3 truncate"
        ><icon-lucide-circle-dot class="h-4 w-4" /><span class="truncate"
          >Calculator</span
        >
      </CommandItem>
    </CommandGroup>
    <CommandSeparator />
    <CommandGroup heading="Settings">
      <CommandItem value="profile" class="grow justify-start gap-3 truncate"
        ><icon-lucide-circle-dot class="h-4 w-4" /><span class="truncate"
          >Profile</span
        >
        <CommandShortcut>⌘ P</CommandShortcut>
      </CommandItem>
      <CommandItem value="billing" class="grow justify-start gap-3 truncate"
        ><icon-lucide-circle-dot class="h-4 w-4" /><span class="truncate"
          >Billing</span
        >
        <CommandShortcut>⌘ B</CommandShortcut>
      </CommandItem>
      <CommandItem value="settings" class="grow justify-start gap-3 truncate"
        ><icon-lucide-circle-dot class="h-4 w-4" /><span class="truncate"
          >Settings</span
        >
        <CommandShortcut>⌘ ,</CommandShortcut>
      </CommandItem>
    </CommandGroup>
  </CommandList>
</template>
