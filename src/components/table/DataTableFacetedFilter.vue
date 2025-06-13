<script setup lang="ts">
import type { Task } from "@/data/schema"
import type { Column } from "@tanstack/vue-table"
import type { Component } from "vue"

interface DataTableFacetedFilter {
  column?: Column<Task, unknown>
  title?: string
  options: {
    label: string
    value: string
    icon?: Component
  }[]
}

const props = defineProps<DataTableFacetedFilter>()

const facets = computed(() => props.column?.getFacetedUniqueValues())
const selectedValues = computed(
  () => new Set(props.column?.getFilterValue() as string[])
)
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button variant="outline" class="border-dashed">
        <icon-lucide-circle-plus />
        {{ title }}
        <template v-if="selectedValues.size > 0">
          <Separator orientation="vertical" />
          <Badge variant="secondary" class="lg:hidden">
            {{ selectedValues.size }}
          </Badge>
          <div class="hidden gap-1 lg:flex">
            <Badge v-if="selectedValues.size > 2" variant="secondary">
              {{ selectedValues.size }} selected
            </Badge>
            <template v-else>
              <Badge
                v-for="option in options.filter((option) =>
                  selectedValues.has(option.value)
                )"
                :key="option.value"
                variant="secondary"
              >
                {{ option.label }}
              </Badge>
            </template>
          </div>
        </template>
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-48 p-0" align="start" side="bottom">
      <Command>
        <CommandInput
          :placeholder="title"
          class="border-none p-0 focus:border-inherit focus:ring-0"
        />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup>
            <CommandItem
              v-for="option in options"
              :key="option.value"
              :value="option"
              class="py-2"
              @select="
                (e) => {
                  const isSelected = selectedValues.has(option.value)
                  if (isSelected) {
                    selectedValues.delete(option.value)
                  } else {
                    selectedValues.add(option.value)
                  }
                  const filterValues = Array.from(selectedValues)
                  column?.setFilterValue(
                    filterValues.length ? filterValues : undefined
                  )
                }
              "
            >
              <Checkbox :model-value="selectedValues.has(option.value)" />
              <component :is="option.icon" v-if="option.icon" />
              {{ option.label }}
              <kbd
                v-if="facets?.get(option.value)"
                class="shortcut-key ml-auto"
              >
                {{ facets.get(option.value) }}
              </kbd>
            </CommandItem>
          </CommandGroup>
          <template v-if="selectedValues.size > 0">
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                :value="{ label: 'Clear filters' }"
                class="justify-center py-2"
                @select="column?.setFilterValue(undefined)"
              >
                Clear filters
              </CommandItem>
            </CommandGroup>
          </template>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
</template>
