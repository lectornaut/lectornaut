<script setup lang="ts">
import { themes } from "@/helpers/defaults"
import { store } from "@/modules/theme"
</script>

<template>
  <TooltipProvider>
    <Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="xs">
              <icon-lucide-sun v-if="store == 'light'" />
              <icon-lucide-moon v-if="store == 'dark'" />
              <icon-lucide-monitor v-if="store == 'auto'" />
              <span class="sr-only">{{ store }}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent> Change theme </TooltipContent>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup v-model="store">
            <DropdownMenuRadioItem
              v-for="mode in themes"
              :key="mode.id"
              :value="mode.id"
              class="gap-4"
            >
              {{ mode.name }}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </Tooltip>
  </TooltipProvider>
</template>
