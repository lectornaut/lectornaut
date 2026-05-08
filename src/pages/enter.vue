<script lang="ts" setup>
definePage({
  // requiresGuest applies to the whole /enter subtree — propagates to
  // child routes via vue-router's meta merging.
  meta: {
    requiresGuest: true,
  },
})
</script>

<template>
  <RouterView />
</template>
