<script lang="ts" setup>
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
              <Component :is="themes.find((t) => t.id === store)?.icon" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {{ $t("components.colorMode.tooltip") }}
        </TooltipContent>
        <DropdownMenuContent class="w-46">
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
