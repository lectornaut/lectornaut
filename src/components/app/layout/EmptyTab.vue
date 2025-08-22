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
  <div class="m-auto w-full max-w-5xl p-2">
    <ul
      class="grid w-full grid-cols-1 gap-2 rounded-2xl border border-dashed p-2 md:grid-cols-2"
    >
      <li v-for="(item, itemIdx) in items" :key="itemIdx" class="flow-root">
        <div
          class="focus-within:bg-accent hover:bg-accent transistion relative flex items-center space-x-4 rounded-xl p-2"
        >
          <div
            :class="[
              item.background,
              'text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-md',
            ]"
          >
            <Component :is="item.icon" class="size-4" />
          </div>
          <div class="grid">
            <h3 class="font-medium">
              {{ item.title }}
            </h3>
            <p class="text-secondary-foreground text-xs">
              {{ item.description }}
            </p>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
