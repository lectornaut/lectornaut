<script lang="ts" setup>
// One layout for every app page, `/bot` included, so navigating between them
// keeps the shell (sidebar, tab strip, global dialogs) mounted instead of
// tearing it down and replaying its entrance animations. A `?popout=1` window
// (detached chat) renders the page bare and never runs the shell's setup.
const route = useRoute()
const isPopout = computed(() => route.query.popout === "1")
</script>

<template>
  <RouterView v-if="isPopout" />
  <AppShell v-else />
</template>
