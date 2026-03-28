<script lang="ts" setup>
import { state } from "@/modules/theme"
import type { OverlayScrollbars } from "overlayscrollbars"
import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
} from "overlayscrollbars-vue"

const overlayScrollbars =
  useTemplateRef<OverlayScrollbarsComponentRef>("overlayScrollbars")
const showTopHint = ref(false)
const showBottomHint = ref(false)

const osOptions = computed(() => ({
  scrollbars: {
    theme: state.value === "light" ? "os-theme-dark" : "os-theme-light",
    autoHide: "scroll" as const,
    autoHideDelay: 800,
    clickScroll: true,
  },
}))

const updateScrollHints = (instance?: OverlayScrollbars | null) => {
  const currentInstance = instance ?? overlayScrollbars.value?.osInstance()
  if (!currentInstance) return

  const { scrollOffsetElement } = currentInstance.elements()
  const scrollTop = scrollOffsetElement.scrollTop
  const maxScrollTop =
    scrollOffsetElement.scrollHeight - scrollOffsetElement.clientHeight

  const top = scrollTop > 1
  const bottom = maxScrollTop - scrollTop > 1

  if (showTopHint.value !== top) showTopHint.value = top
  if (showBottomHint.value !== bottom) showBottomHint.value = bottom
}

const handleInitialized = (instance: OverlayScrollbars) => {
  nextTick(() => updateScrollHints(instance))
}
</script>

<template>
  <OverlayScrollbarsComponent
    ref="overlayScrollbars"
    class="overlay-scrollbars-wrapper relative size-full min-h-0 min-w-0 grow overflow-auto"
    :class="{
      'show-top-hint': showTopHint,
      'show-bottom-hint': showBottomHint,
    }"
    defer
    :options="osOptions"
    @os-initialized="handleInitialized"
    @os-scroll="updateScrollHints"
    @os-updated="updateScrollHints"
  >
    <slot />
  </OverlayScrollbarsComponent>
</template>

<style scoped>
:deep([data-overlayscrollbars-initialize]),
:deep(.os-host),
:deep([data-overlayscrollbars-contents]) {
  display: flex;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  flex: 1 1 0%;
  flex-direction: column;
}

.overlay-scrollbars-wrapper {
  contain: layout style;
}

.overlay-scrollbars-wrapper::before,
.overlay-scrollbars-wrapper::after {
  content: "";
  position: absolute;
  inset-inline: 0;
  height: 20px;
  pointer-events: none;
  z-index: 1;
  opacity: 0;
  transition: opacity 200ms ease;
  will-change: opacity;
  backface-visibility: hidden;
}

.overlay-scrollbars-wrapper::before {
  top: 0;
  background-image: linear-gradient(var(--color-background), transparent);
}

.overlay-scrollbars-wrapper::after {
  bottom: 0;
  background-image: linear-gradient(transparent, var(--color-background));
}

.overlay-scrollbars-wrapper.show-top-hint::before {
  opacity: 0.75;
}

.overlay-scrollbars-wrapper.show-bottom-hint::after {
  opacity: 0.75;
}
</style>
