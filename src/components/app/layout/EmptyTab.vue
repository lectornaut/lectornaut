<script setup lang="ts">
import CalendarIcon from "~icons/lucide/calendar"
import CameraIcon from "~icons/lucide/camera"
import ClockIcon from "~icons/lucide/clock"
import ColumnsIcon from "~icons/lucide/columns"
import ListIcon from "~icons/lucide/list"
import TableIcon from "~icons/lucide/table"

const items = [
  {
    title: "Create a List",
    description: "Another to-do system you'll try but eventually give up on.",
    icon: ListIcon,
    background: "bg-pink-600",
  },
  {
    title: "Create a Calendar",
    description: "Stay on top of your deadlines, or don't — it's up to you.",
    icon: CalendarIcon,
    background: "bg-orange-600",
  },
  {
    title: "Create a Gallery",
    description: "Great for mood boards and inspiration.",
    icon: CameraIcon,
    background: "bg-green-600",
  },
  {
    title: "Create a Board",
    description: "Track tasks in different stages of your project.",
    icon: ColumnsIcon,
    background: "bg-blue-600",
  },
  {
    title: "Create a Spreadsheet",
    description: "Lots of numbers and things — good for nerds.",
    icon: TableIcon,
    background: "bg-indigo-600",
  },
  {
    title: "Create a Timeline",
    description: "Get a birds-eye-view of your procrastination.",
    icon: ClockIcon,
    background: "bg-purple-600",
  },
]
</script>

<template>
  <div
    class="mx-auto grid w-full max-w-5xl grid-cols-1 gap-2 p-2 md:grid-cols-2"
  >
    <Button
      v-for="(item, itemIdx) in items"
      :key="itemIdx"
      variant="ghost"
      class="flex h-auto flex-1 grow justify-start gap-4 p-2"
    >
      <div
        :class="[
          item.background,
          'text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded',
        ]"
      >
        <Component :is="item.icon" class="size-4" />
      </div>
      <div class="grid grid-cols-1 text-left">
        <h3 class="font-medium">
          {{ item.title }}
        </h3>
        <p class="text-secondary-foreground truncate text-xs">
          {{ item.description }}
        </p>
      </div>
    </Button>
  </div>
</template>
