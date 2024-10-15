<script setup lang="ts">
useHead({
  title: "404",
})
</script>

<template>
  <div class="grid grow place-items-center p-2">
    <Button variant="link" class="gap-1" as-child>
      <RouterLink to="/enter">
        <icon-lucide-chevron-left /> Back to Home
      </RouterLink>
    </Button>
  </div>
</template>
