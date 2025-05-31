<route lang="json">
{
  "meta": {
    "layout": "app",
    "requiresUser": true,
    "title": "Home"
  }
}
</route>

<script setup lang="ts">
import Avatar from "vue-boring-avatars"

useHead({
  title: "Home",
})
</script>

<template>
  <div class="flex grow flex-col overflow-auto overscroll-none">
    <div class="flex grow items-center justify-center">
      <Avatar
        name="qwerty"
        :size="40"
        variant="beam"
        :title="false"
        :square="false"
        :colors="[
          'var(--chart-5)',
          'var(--chart-4)',
          'var(--chart-3)',
          'var(--chart-1)',
          'var(--chart-1)',
        ]"
        class="rounded-full"
      />
    </div>
  </div>
</template>
