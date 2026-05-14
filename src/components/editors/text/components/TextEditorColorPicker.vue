<script lang="ts" setup>
import { IconCheck, IconX } from "@/data/icons"

export interface ColorOption {
  id: string
  name: string
  value: string
}

withDefaults(
  defineProps<{
    colors: ColorOption[]
    activeColor?: string | null
    title?: string
    swatchClass?: string
    disabled?: boolean
  }>(),
  {
    activeColor: null,
    title: "Color",
    swatchClass: "size-4 border",
    disabled: false,
  }
)

const emit = defineEmits<{
  (e: "select", value: string): void
  (e: "clear"): void
}>()
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        size="icon"
        :disabled="disabled"
        class="data-[state=open]:bg-accent"
      >
        <slot name="trigger" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-52 p-2">
      <div class="mb-2 text-xs font-medium">{{ title }}</div>
      <div class="grid grid-cols-5 gap-1">
        <Button
          v-for="color in colors"
          :key="color.id"
          variant="ghost"
          size="icon"
          :title="color.name"
          class="relative"
          @click="emit('select', color.value)"
        >
          <span
            :class="swatchClass"
            :style="{ backgroundColor: color.value }"
          />
          <span
            v-if="activeColor === color.value"
            class="bg-background/85 absolute inset-0 flex items-center justify-center"
          >
            <IconCheck />
          </span>
        </Button>
        <Button variant="ghost" size="icon" @click="emit('clear')">
          <IconX />
        </Button>
      </div>
    </PopoverContent>
  </Popover>
</template>
