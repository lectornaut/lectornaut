<script lang="ts" setup>
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  type VirtualElement,
} from "@floating-ui/dom"
import type { Component } from "vue"

interface CommandPanelItem {
  id: string
  title: string
  description?: string
  group: string
  icon?: Component
  shortcut?: string
}

const props = withDefaults(
  defineProps<{
    open: boolean
    items: CommandPanelItem[]
    selectedIndex: number
    /** Live caret rect from the suggestion (re-read on every reposition). */
    getRect?: (() => DOMRect | null) | null
    /** The editor DOM: scroll ancestors are watched from here. */
    contextElement?: HTMLElement | null
    /** Listbox id; options are `${panelId}-${index}` (aria-activedescendant). */
    panelId: string
    label: string
    emptyText: string
  }>(),
  {
    getRect: null,
    contextElement: null,
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

const floating = useTemplateRef<HTMLElement>("floating")
const position = ref({ left: "0px", top: "0px" })
let reposition: (() => void) | null = null

// Anchored to the caret: below it, flipping above near the bottom edge and
// shifting inside the viewport; follows scroll/resize of the editor's scroll
// ancestors and the panel's own size changes (filtering).
watch(
  [() => props.open, floating],
  ([open, el], _, onCleanup) => {
    if (!open || !el) return
    const reference: VirtualElement = {
      getBoundingClientRect: () => props.getRect?.() ?? new DOMRect(),
      contextElement: props.contextElement ?? undefined,
    }
    reposition = () =>
      void computePosition(reference, el, {
        strategy: "fixed",
        placement: "bottom-start",
        middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        position.value = { left: `${x}px`, top: `${y}px` }
      })
    const stop = autoUpdate(reference, el, reposition)
    onCleanup(() => {
      stop()
      reposition = null
    })
  },
  { flush: "post" }
)

// Typing moves the caret without any scroll/resize event.
watch(
  () => props.getRect,
  () => reposition?.()
)

// Keep the keyboard selection in view.
watch(
  () => props.selectedIndex,
  (index) => {
    nextTick(() =>
      floating.value
        ?.querySelector(`[data-index="${index}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "instant" })
    )
  }
)
</script>

<template>
  <div v-if="open" ref="floating" class="fixed z-50 w-80" :style="position">
    <Command
      :id="panelId"
      :model-value="selectedValue"
      :aria-label="label"
      class="ring-foreground/5 dark:ring-foreground/10 shadow-lg ring-1 [--radius-command:var(--radius-overlay)]"
    >
      <CommandList>
        <!-- CommandEmpty only reacts to Command's own search, which this
             panel doesn't use (the suggestion filters), so render it here. -->
        <div
          v-if="!items.length"
          class="text-muted-foreground py-6 text-center text-sm"
        >
          {{ emptyText }}
        </div>
        <CommandGroup
          v-for="[groupName, groupItems] in groupedItems"
          :key="groupName"
          :heading="groupName"
          class="**:data-[slot=command-group-heading]:text-muted-foreground **:data-[slot=command-group-heading]:py-2 **:data-[slot=command-group-heading]:pl-2 **:data-[slot=command-group-heading]:text-xs **:data-[slot=command-group-heading]:font-medium"
        >
          <CommandItem
            v-for="item in groupItems"
            :id="`${panelId}-${item.index}`"
            :key="item.id"
            :value="item.id"
            :data-index="item.index"
            class="data-highlighted:bg-muted data-highlighted:text-foreground data-highlighted:**:[svg]:text-foreground gap-3"
            @mousemove="emit('hover', item.index)"
            @select="emit('select', item.index)"
          >
            <component
              :is="item.icon"
              v-if="item.icon"
              class="text-muted-foreground"
            />
            <div class="min-w-0 flex-1">
              <div class="truncate">{{ item.title }}</div>
              <div
                v-if="item.description"
                class="text-muted-foreground truncate text-xs"
              >
                {{ item.description }}
              </div>
            </div>
            <CommandShortcut
              v-if="item.shortcut"
              class="font-mono tracking-normal"
            >
              {{ item.shortcut }}
            </CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  </div>
</template>
