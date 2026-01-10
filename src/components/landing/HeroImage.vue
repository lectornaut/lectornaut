<script lang="ts" setup>
import { state } from "@/modules/theme"
</script>

<template>
  <div class="mx-8 my-4 grid grid-cols-1">
    <img
      :src="`/assets/images/hero-image-${state}.png`"
      alt="Hero Image"
      class="h-auto w-full rounded-lg border shadow-lg"
    />
  </div>
</template>
