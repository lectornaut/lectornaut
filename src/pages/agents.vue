<script lang="ts" setup>
definePage({
  // Children own their chrome. The index opts into the app layout + auth;
  // [id] is a PUBLIC agent profile that renders bare (its own PageHeader,
  // like [username].vue). `setupLayouts` wraps a child route only when the
  // child declares `meta.layout`, and a child can never escape a parent's
  // wrapper — so this parent must stay layout-free and meta-light.
  meta: {
    layout: false,
  },
})
</script>

<template>
  <RouterView />
</template>
