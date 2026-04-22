<script lang="ts" setup>
import { IconLanguages } from "@/data/icons"
import { languages } from "@/helpers/defaults"

const { locale } = useI18n()
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
              <IconLanguages />
              <span class="sr-only">
                {{ languages.find((language) => language.id === locale)?.name }}
              </span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {{ $t("components.languageSwitcher.tooltip") }}
        </TooltipContent>
        <DropdownMenuContent class="w-46">
          <DropdownMenuRadioGroup v-model="locale">
            <DropdownMenuRadioItem
              v-for="language in languages"
              :key="language.id"
              :value="language.id"
            >
              {{ language.name }}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </Tooltip>
  </TooltipProvider>
</template>
