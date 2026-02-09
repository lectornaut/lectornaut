<script lang="ts" setup>
interface CommandPanelItem {
  id: string
  title: string
  description?: string
  group: string
}

const props = withDefaults(
  defineProps<{
    open: boolean
    x: number
    y: number
    items: CommandPanelItem[]
    selectedIndex: number
    label?: string
    emptyText?: string
  }>(),
  {
    label: "Commands",
    emptyText: "No commands found",
  }
)

const emit = defineEmits<{
  (e: "select", index: number): void
  (e: "hover", index: number): void
}>()

const groupedItems = computed(() => {
  const groups = new Map<string, Array<CommandPanelItem & { index: number }>>()

  props.items.forEach((item, index) => {
    const bucket = groups.get(item.group) ?? []
    bucket.push({ ...item, index })
    groups.set(item.group, bucket)
  })

  return [...groups.entries()]
})

const selectedValue = computed(() => props.items[props.selectedIndex]?.id ?? "")
</script>

<template>
  <div
    v-if="open"
    class="fixed z-50 w-80"
    :style="{ left: `${x}px`, top: `${y}px` }"
  >
    <Command :model-value="selectedValue" class="border shadow-lg">
      <div class="text-muted-foreground border-b px-3 py-2 text-xs font-medium">
        {{ label }}
      </div>
      <CommandList>
        <CommandEmpty>{{ emptyText }}</CommandEmpty>
        <CommandGroup
          v-for="[groupName, groupItems] in groupedItems"
          :key="groupName"
          :heading="groupName"
        >
          <CommandItem
            v-for="item in groupItems"
            :key="item.id"
            :value="item.id"
            class="flex items-start py-2"
            @mousemove="emit('hover', item.index)"
            @select="emit('select', item.index)"
          >
            <div class="min-w-0">
              <div class="truncate text-sm">{{ item.title }}</div>
              <div
                v-if="item.description"
                class="text-muted-foreground text-xs"
              >
                {{ item.description }}
              </div>
            </div>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  </div>
</template>
