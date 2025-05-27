<route lang="json">
{
  "meta": {
    "layout": "home",
    "requiresUser": true
  }
}
</route>

<script setup lang="ts">
useHead({
  title: "ID",
})

const route = useRoute() as { params: { id?: string } }
</script>

<template>
  <div class="p-2">
    {{ route.params.id }}
  </div>
</template>
