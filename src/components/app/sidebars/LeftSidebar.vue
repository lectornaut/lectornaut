<script setup lang="ts">
defineProps<{
  leftSidebarVisibility: boolean
}>()
</script>

<template>
  <div class="flex grow flex-col">
    <AccountSwitcher :left-sidebar-visibility="leftSidebarVisibility" />
    <Separator />
    <aside class="no-scrollbar flex grow flex-col overflow-auto">
      <Navigation :left-sidebar-visibility="leftSidebarVisibility" />
    </aside>
    <Support />
  </div>
</template>
