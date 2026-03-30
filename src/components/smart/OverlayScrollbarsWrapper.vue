<script lang="ts" setup>
import { state } from "@/modules/theme"
import type { OverlayScrollbars } from "overlayscrollbars"
import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
  useOverlayScrollbars,
} from "overlayscrollbars-vue"

const props = withDefaults(
  defineProps<{
    showBlockHints?: boolean
    showInlineHints?: boolean
    targetSelector?: string
  }>(),
  {
    showBlockHints: true,
    showInlineHints: false,
  }
)
const attrs = useAttrs()

const overlayScrollbars =
  useTemplateRef<OverlayScrollbarsComponentRef>("overlayScrollbars")
const overlayContent = useTemplateRef<HTMLElement>("overlayContent")
const showTopHint = ref(false)
const showBottomHint = ref(false)
const showLeftHint = ref(false)
const showRightHint = ref(false)

const osOptions = computed(() => ({
  scrollbars: {
    theme: state.value === "light" ? "os-theme-dark" : "os-theme-light",
    autoHide: "scroll" as const,
    autoHideDelay: 800,
    clickScroll: true,
  },
}))

// Computed for lazy evaluation: breaks circular dependency since
// handleInitialized/updateScrollHints are defined after useOverlayScrollbars.
// Arrow wrappers prevent Vue from tracking internal reactive state of
// useThrottleFn inside the computed's dependency collection.
const osEvents = computed(() => ({
  initialized: [(instance: OverlayScrollbars) => handleInitialized(instance)],
  scroll: [(instance: OverlayScrollbars) => updateScrollHints(instance)],
  updated: [(instance: OverlayScrollbars) => updateScrollHints(instance)],
}))

const noopScrollbars: ReturnType<typeof useOverlayScrollbars> = [
  () => {},
  () => null,
]

const [initializeOverlayScrollbars, adoptedOverlayScrollbars] =
  props.targetSelector
    ? useOverlayScrollbars({
        options: osOptions,
        events: osEvents,
        defer: true,
      })
    : noopScrollbars

const getInstance = () =>
  props.targetSelector
    ? adoptedOverlayScrollbars()
    : overlayScrollbars.value?.osInstance()

const updateScrollHints = useThrottleFn(
  (instance?: OverlayScrollbars | null) => {
    const currentInstance = instance ?? getInstance()
    if (!currentInstance) return

    const { scrollOffsetElement } = currentInstance.elements()

    if (props.showBlockHints) {
      const scrollTop = scrollOffsetElement.scrollTop
      const maxScrollTop =
        scrollOffsetElement.scrollHeight - scrollOffsetElement.clientHeight

      const top = scrollTop > 1
      const bottom = maxScrollTop - scrollTop > 1

      if (showTopHint.value !== top) showTopHint.value = top
      if (showBottomHint.value !== bottom) showBottomHint.value = bottom
    }

    if (props.showInlineHints) {
      const scrollLeft = scrollOffsetElement.scrollLeft
      const maxScrollLeft =
        scrollOffsetElement.scrollWidth - scrollOffsetElement.clientWidth

      const left = scrollLeft > 1
      const right = maxScrollLeft - scrollLeft > 1

      if (showLeftHint.value !== left) showLeftHint.value = left
      if (showRightHint.value !== right) showRightHint.value = right
    }
  },
  16
)

const handleInitialized = (instance: OverlayScrollbars) => {
  nextTick(() => updateScrollHints(instance))
}

const initializeTarget = async () => {
  if (!props.targetSelector) return

  await nextTick()

  const target = overlayContent.value?.querySelector<HTMLElement>(
    props.targetSelector
  )
  if (!target) return

  initializeOverlayScrollbars(target)
  nextTick(() => updateScrollHints())
}

if (props.targetSelector) {
  onMounted(() => {
    initializeTarget()
  })

  onUpdated(() => {
    if (!adoptedOverlayScrollbars()) initializeTarget()
  })
}

const getScrollElement = () => getInstance()?.elements().scrollOffsetElement

defineExpose({
  getScrollElement,
})
</script>

<template>
  <div
    class="overlay-scrollbars-wrapper relative flex size-full min-h-0 min-w-0 grow overflow-hidden"
  >
    <OverlayScrollbarsComponent
      v-if="!props.targetSelector"
      ref="overlayScrollbars"
      class="overlay-scrollbars-wrapper__viewport size-full min-h-0 min-w-0 grow overflow-auto"
      :data-tauri-drag-region="attrs['data-tauri-drag-region']"
      defer
      :options="osOptions"
      @os-initialized="handleInitialized"
      @os-scroll="updateScrollHints"
      @os-updated="updateScrollHints"
    >
      <slot />
    </OverlayScrollbarsComponent>
    <div
      v-else
      ref="overlayContent"
      class="overlay-scrollbars-wrapper__content size-full min-h-0 min-w-0 grow"
    >
      <slot />
    </div>
    <div
      v-if="props.showBlockHints"
      aria-hidden="true"
      class="overlay-scrollbars-wrapper__hint overlay-scrollbars-wrapper__hint--top"
      :class="{ 'is-visible': showTopHint }"
    />
    <div
      v-if="props.showBlockHints"
      aria-hidden="true"
      class="overlay-scrollbars-wrapper__hint overlay-scrollbars-wrapper__hint--bottom"
      :class="{ 'is-visible': showBottomHint }"
    />
    <div
      v-if="props.showInlineHints"
      aria-hidden="true"
      class="overlay-scrollbars-wrapper__hint overlay-scrollbars-wrapper__hint--left"
      :class="{ 'is-visible': showLeftHint }"
    />
    <div
      v-if="props.showInlineHints"
      aria-hidden="true"
      class="overlay-scrollbars-wrapper__hint overlay-scrollbars-wrapper__hint--right"
      :class="{ 'is-visible': showRightHint }"
    />
  </div>
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

.overlay-scrollbars-wrapper__content {
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

.overlay-scrollbars-wrapper__hint {
  position: absolute;
  pointer-events: none;
  z-index: 1;
  opacity: 0;
  transition: opacity 200ms ease;
  backface-visibility: hidden;
}

.overlay-scrollbars-wrapper__hint.is-visible {
  opacity: 0.75;
  will-change: opacity;
}

.overlay-scrollbars-wrapper__hint--top,
.overlay-scrollbars-wrapper__hint--bottom {
  inset-inline: 0;
  height: 16px;
}

.overlay-scrollbars-wrapper__hint--top {
  top: 0;
  background-image: linear-gradient(var(--color-background), transparent);
}

.overlay-scrollbars-wrapper__hint--bottom {
  bottom: 0;
  background-image: linear-gradient(transparent, var(--color-background));
}

.overlay-scrollbars-wrapper__hint--left,
.overlay-scrollbars-wrapper__hint--right {
  inset-block: 0;
  width: 16px;
}

.overlay-scrollbars-wrapper__hint--left {
  left: 0;
  background-image: linear-gradient(
    to right,
    var(--color-background),
    transparent
  );
}

.overlay-scrollbars-wrapper__hint--right {
  right: 0;
  background-image: linear-gradient(
    to left,
    var(--color-background),
    transparent
  );
}
</style>
