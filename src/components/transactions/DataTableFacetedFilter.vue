<script lang="ts" setup>
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
      <Button variant="outline" size="sm" class="gap-2 border-dashed">
        <icon-lucide-plus-circle />
        {{ title }}
        <template v-if="selectedValues.size > 0">
          <Separator orientation="vertical" class="mx-2 h-4" />
          <Badge
            variant="secondary"
            class="rounded-sm px-1 font-normal lg:hidden"
          >
            {{ selectedValues.size }}
          </Badge>
          <div class="hidden space-x-1 lg:flex">
            <Badge
              v-if="selectedValues.size > 2"
              variant="secondary"
              class="rounded-sm px-1 font-normal"
            >
              {{ selectedValues.size }} selected
            </Badge>

            <template v-else>
              <Badge
                v-for="option in options.filter((option) =>
                  selectedValues.has(option.value)
                )"
                :key="option.value"
                variant="secondary"
                class="rounded-sm px-1 font-normal"
              >
                {{ option.label }}
              </Badge>
            </template>
          </div>
        </template>
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-auto p-0" align="start">
      <Command>
        <CommandInput
          :placeholder="title"
          class="border-none focus:border-inherit focus:ring-0"
        />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup>
            <CommandItem
              v-for="option in options"
              :key="option.value"
              :value="option.label"
              class="gap-2"
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
              <Checkbox
                :checked="selectedValues.has(option.value)"
                class="flex aspect-square h-3 w-3 rounded-sm border-muted-foreground data-[state=checked]:bg-muted-foreground"
              />
              <Component :is="option.icon" v-if="option.icon" />
              <span>{{ option.label }}</span>
              <CommandShortcut v-if="facets?.get(option.value)">
                {{ facets.get(option.value) }}
              </CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <template v-if="selectedValues.size > 0">
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                :value="{ label: 'Clear filters' }"
                class="justify-center text-center"
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
