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
              size="icon"
              class="data-[state=open]:bg-accent"
            >
              <icon-lucide-sun v-if="store == 'light'" />
              <icon-lucide-moon v-if="store == 'dark'" />
              <icon-lucide-palette v-if="store == 'custom'" />
              <icon-lucide-monitor v-if="store == 'auto'" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent> Change theme </TooltipContent>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup v-model="store">
            <DropdownMenuRadioItem
              v-for="mode in themes"
              :key="mode.id"
              :value="mode.id"
            >
              {{ mode.name }}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </Tooltip>
  </TooltipProvider>
</template>
