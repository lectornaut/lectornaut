<script setup lang="ts">
const route = useRoute()
</script>

<template>
  <div class="p-2">
    {{ route.params.id }}
  </div>
</template>

<route lang="json">
{
  "meta": {
    "layout": "workflows",
    "requiresUser": true
  }
}
</route>
