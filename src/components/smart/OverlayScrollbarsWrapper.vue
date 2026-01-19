<script lang="ts" setup>
import { state } from "@/modules/theme"
import { OverlayScrollbarsComponent } from "overlayscrollbars-vue"
</script>

<template>
  <OverlayScrollbarsComponent
    defer
    :options="{
      scrollbars: {
        theme: state === 'light' ? 'os-theme-dark' : 'os-theme-light',
        autoHide: 'scroll',
      },
    }"
    class="size-full overflow-auto overscroll-none scroll-smooth"
  >
    <slot />
  </OverlayScrollbarsComponent>
</template>
