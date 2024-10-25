<script setup lang="ts">
import { themes } from "@/helpers/defaults"
import { store } from "@/modules/theme"
</script>

<template>
  <TooltipProvider>
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger as-child>
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="xs"
              class="data-[state=open]:bg-muted"
            >
              <icon-lucide-sun v-if="store == 'light'" />
              <icon-lucide-moon v-if="store == 'dark'" />
              <icon-lucide-monitor v-if="store == 'auto'" />
              <span class="sr-only">
                {{ store }}
              </span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent> Change theme </TooltipContent>
        <DropdownMenuContent align="start">
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
