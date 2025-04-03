<script setup lang="ts">
import { languages } from "@/helpers/defaults"

const { locale } = useI18n()
watch(locale, (newLocale) => localStorage.setItem("locale", newLocale))
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
              <icon-lucide-languages />
              <span class="sr-only">
                {{ languages.find((language) => language.id === locale)?.name }}
              </span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent> Change language </TooltipContent>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Language</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup v-model="locale">
            <DropdownMenuRadioItem
              v-for="language in languages"
              :key="language.id"
              class="gap-4"
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
