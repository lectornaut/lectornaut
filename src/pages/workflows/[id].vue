<route lang="json">
{
  "meta": {
    "layout": "workflows",
    "requiresUser": true
  }
}
</route>

<script setup lang="ts">
useHead({
  title: "ID",
})

const route = useRoute()
</script>

<template>
  <div class="p-2">
    {{ route.params.id }}
  </div>
</template>
