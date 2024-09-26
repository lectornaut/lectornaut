<script setup lang="ts">
useHead({
  title: "Exit",
})
</script>

<template>
  <div class="flex grow place-items-center">
    <ExitTrigger><Button variant="secondary">Logout</Button></ExitTrigger>
  </div>
</template>

<route lang="json">
{
  "meta": {
    "requiresGuest": true
  }
}
</route>
