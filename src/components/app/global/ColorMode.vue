<script lang="ts" setup>
import { IconMonitor, IconMoon, IconPalette, IconSun } from "@/data/icons"
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
              <IconSun v-if="store == 'light'" />
              <IconMoon v-if="store == 'dark'" />
              <IconPalette v-if="store == 'accent'" />
              <IconMonitor v-if="store == 'auto'" />
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
