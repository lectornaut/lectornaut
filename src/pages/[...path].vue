<script lang="ts" setup>
import { IconChevronLeft } from "@/data/icons"

definePage({
  meta: {
    layout: "landing",
  },
})

useHead({
  title: "404",
})
</script>

<template>
  <div class="grid grow place-items-center p-2">
    <Button variant="link" class="gap-1" as-child>
      <RouterLink to="/"> <IconChevronLeft /> Back to Home </RouterLink>
    </Button>
  </div>
</template>
