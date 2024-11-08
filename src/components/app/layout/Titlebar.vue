<script setup lang="ts">
const tabs = [
  { name: "Design", id: "design" },
  { name: "Interact", id: "interact" },
]

const selectedTab = ref("design")
</script>

<template>
  <header
    data-tauri-drag-region
    class="flex min-h-titlebar-height items-center justify-center"
  >
    <div class="flex h-full min-h-7">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        :class="[
          selectedTab === tab.id
            ? 'border-primary text-primary'
            : 'border-transparent text-muted-foreground hover:border-primary/25 hover:text-primary/75',
          'z-50 -mb-px flex grow items-center justify-center border-b px-2 font-semibold transition',
        ]"
        @click="selectedTab = tab.id"
      >
        <span class="scale-95 truncate">
          {{ tab.name }}
        </span>
      </button>
    </div>
  </header>
</template>
