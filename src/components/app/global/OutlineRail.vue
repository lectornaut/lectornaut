<script lang="ts" setup>
// Shared outline rail: the doc TOC (TextEditor) and the chat transcript
// outline (BotChatOutline) both render through this so they look and
// behave the same. Callers own the data and the scroll; this owns the UI.
export type OutlineRailItem = {
  id: string
  label: string
  active: boolean
  /** Importance, 1 = widest bar. Defaults to 2. */
  level?: number
  /** Nesting depth for the hover list indent, 1 = flush. Defaults to 1. */
  depth?: number
}

defineProps<{
  items: OutlineRailItem[]
  label: string
}>()

const emit = defineEmits<{ select: [id: string] }>()

// Wider = more important: level 1 1.5rem, 2 1rem, 3+ 0.5rem.
const barWidth = (level = 2) => `${Math.max(4 - level, 1) * 0.5}rem`

// Indent follows nesting, like Notion. Base 0.75rem matches row padding.
const rowIndent = (depth = 1) => `${0.75 + Math.max(depth - 1, 0) * 0.75}rem`
</script>

<template>
  <div
    v-if="items.length"
    class="pointer-events-none absolute inset-y-0 left-2 z-10 flex items-center"
  >
    <!-- The bars are an overview; hovering opens the outline (indented by
         nesting, current entry highlighted, click to jump). -->
    <HoverCard :open-delay="100" :close-delay="150">
      <HoverCardTrigger as-child>
        <aside
          class="pointer-events-auto flex max-h-full flex-col items-start overflow-y-auto py-2 pr-2"
        >
          <button
            v-for="item in items"
            :key="item.id"
            type="button"
            class="group flex cursor-pointer py-1"
            :aria-label="item.label"
            @click="emit('select', item.id)"
          >
            <span
              class="bg-sidebar-primary h-0.5 rounded-full opacity-25 group-hover:opacity-75"
              :class="{ 'opacity-75': item.active }"
              :style="{ width: barWidth(item.level) }"
            />
          </button>
        </aside>
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="center"
        :side-offset="4"
        class="max-h-[min(28rem,var(--reka-hover-card-content-available-height))] w-64 overflow-y-auto p-1.5"
      >
        <nav :aria-label="label" class="flex flex-col">
          <button
            v-for="item in items"
            :key="item.id"
            type="button"
            class="hover:bg-accent hover:text-accent-foreground w-full truncate rounded-2xl py-2 pr-3 text-left text-sm"
            :class="
              item.active
                ? 'text-foreground font-medium'
                : 'text-muted-foreground'
            "
            :aria-current="item.active ? 'location' : undefined"
            :style="{ paddingLeft: rowIndent(item.depth) }"
            @click="emit('select', item.id)"
          >
            {{ item.label }}
          </button>
        </nav>
      </HoverCardContent>
    </HoverCard>
  </div>
</template>
