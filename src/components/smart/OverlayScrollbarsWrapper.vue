<script lang="ts" setup>
import { state } from "@/modules/theme"
import type { OverlayScrollbars } from "overlayscrollbars"
import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
} from "overlayscrollbars-vue"

const props = withDefaults(
  defineProps<{
    scrollHint?: boolean
  }>(),
  { scrollHint: true }
)

const overlayScrollbars =
  useTemplateRef<OverlayScrollbarsComponentRef>("overlayScrollbars")
const showTopHint = ref(false)
const showBottomHint = ref(false)

const updateScrollHints = (instance?: OverlayScrollbars | null) => {
  if (!props.scrollHint) {
    showTopHint.value = false
    showBottomHint.value = false
    return
  }

  const currentInstance = instance ?? overlayScrollbars.value?.osInstance()
  if (!currentInstance) {
    return
  }

  const { scrollOffsetElement } = currentInstance.elements()
  const maxScrollTop = Math.max(
    scrollOffsetElement.scrollHeight - scrollOffsetElement.clientHeight,
    0
  )
  const scrollTop = scrollOffsetElement.scrollTop

  showTopHint.value = scrollTop > 1
  showBottomHint.value = maxScrollTop - scrollTop > 1
}

const handleInitialized = (instance: OverlayScrollbars) => {
  nextTick(() => updateScrollHints(instance))
}

const handleUpdated = (instance: OverlayScrollbars) => {
  updateScrollHints(instance)
}

const handleScroll = (instance: OverlayScrollbars) => {
  updateScrollHints(instance)
}

watch(
  () => props.scrollHint,
  (scrollHint) => {
    if (!scrollHint) {
      showTopHint.value = false
      showBottomHint.value = false
      return
    }

    nextTick(() => updateScrollHints())
  },
  { immediate: true }
)
</script>

<template>
  <OverlayScrollbarsComponent
    ref="overlayScrollbars"
    class="overlay-scrollbars-wrapper relative size-full min-h-0 min-w-0 grow overflow-auto"
    :class="{
      'show-top-hint': props.scrollHint && showTopHint,
      'show-bottom-hint': props.scrollHint && showBottomHint,
    }"
    defer
    :options="{
      scrollbars: {
        theme: state === 'light' ? 'os-theme-dark' : 'os-theme-light',
        autoHide: 'scroll',
      },
    }"
    @os-initialized="handleInitialized"
    @os-scroll="handleScroll"
    @os-updated="handleUpdated"
  >
    <slot />
  </OverlayScrollbarsComponent>
</template>

<style scoped>
:deep([data-overlayscrollbars-initialize]),
:deep(.os-host) {
  display: flex;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  flex: 1 1 0%;
  flex-direction: column;
}

:deep([data-overlayscrollbars-contents]) {
  display: flex;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  flex: 1 1 0%;
  flex-direction: column;
}

.overlay-scrollbars-wrapper::before,
.overlay-scrollbars-wrapper::after {
  content: "";
  position: absolute;
  inset-inline: 0;
  height: 16px;
  pointer-events: none;
  z-index: 1;
  opacity: 0;
  transition: opacity 200ms ease;
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
  opacity: 0.9;
}

.overlay-scrollbars-wrapper.show-bottom-hint::after {
  opacity: 0.9;
}
</style>
