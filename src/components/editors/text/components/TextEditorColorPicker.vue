<script lang="ts" setup>
import { IconBan } from "@/data/icons"

const { t } = useI18n()

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
    swatchClass: "size-5 rounded-full border border-foreground/10",
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
        variant="ghost"
        size="icon"
        :disabled="disabled"
        :aria-label="title"
        :title="title"
        class="data-[state=open]:bg-accent"
      >
        <slot name="trigger" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-52 gap-0 p-2">
      <div class="text-muted-foreground px-1.5 pt-1.5 pb-2 text-xs font-medium">
        {{ title }}
      </div>
      <div class="grid grid-cols-5 gap-1">
        <Button
          v-for="color in colors"
          :key="color.id"
          variant="ghost"
          size="icon"
          :title="color.name"
          :aria-pressed="activeColor === color.value"
          @click="emit('select', color.value)"
        >
          <span
            :class="[
              swatchClass,
              activeColor === color.value &&
                'ring-foreground ring-offset-popover ring-2 ring-offset-2',
            ]"
            :style="{ backgroundColor: color.value }"
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          :aria-label="t('components.textEditor.clearColor')"
          :title="t('components.textEditor.clearColor')"
          @click="emit('clear')"
        >
          <IconBan class="text-muted-foreground size-5" />
        </Button>
      </div>
    </PopoverContent>
  </Popover>
</template>
