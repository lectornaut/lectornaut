<!-- <script setup lang="ts">
import { state } from "@/modules/theme"
import { OverlayScrollbarsComponent } from "overlayscrollbars-vue"
</script> -->

<template>
  <div class="size-full overflow-auto overscroll-none">
    <!-- <OverlayScrollbarsComponent
    defer
    :options="{
      scrollbars: {
        theme: state === 'light' ? 'os-theme-dark' : 'os-theme-light',
        autoHide: 'scroll',
      },
    }"
    class="size-full overscroll-none"
  > -->
    <slot />
    <!-- </OverlayScrollbarsComponent> -->
  </div>
</template>
