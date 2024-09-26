<script setup lang="ts">
import { isTauri } from "@/helpers/utilities"
</script>

<template>
  <div
    data-tauri-drag-region
    class="fixed inset-x-0 top-0 z-20 flex items-center justify-between gap-2 p-2"
    :class="{ 'pl-20': isTauri }"
  >
    <div class="flex grow items-center justify-start">
      <Button size="xs"><icon-material-symbols-circle /></Button>
      <Button variant="link" class="gap-2 font-semibold" size="xs">
        Template App
      </Button>
    </div>
    <div class="flex grow items-center justify-center"></div>
    <div class="flex grow items-center justify-end">
      <LanguageSwitcher />
      <ColorMode />
    </div>
  </div>
</template>
