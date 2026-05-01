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

// Emitted once OverlayScrollbars finishes its deferred init and the real
// scroll viewport is in the DOM. Consumers (e.g. auto-scrolling chats)
// use this to wire `useScroll` against the actual scrolling element
// instead of polling `getScrollElement()`.
const emit = defineEmits<{
  scrollReady: [scrollEl: HTMLElement]
}>()

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
// handleInitialized / updateScrollHints are defined after useOverlayScrollbars.
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
    } else {
      if (showTopHint.value) showTopHint.value = false
      if (showBottomHint.value) showBottomHint.value = false
    }

    if (props.showInlineHints) {
      const scrollLeft = scrollOffsetElement.scrollLeft
      const maxScrollLeft =
        scrollOffsetElement.scrollWidth - scrollOffsetElement.clientWidth

      const left = scrollLeft > 1
      const right = maxScrollLeft - scrollLeft > 1

      if (showLeftHint.value !== left) showLeftHint.value = left
      if (showRightHint.value !== right) showRightHint.value = right
    } else {
      if (showLeftHint.value) showLeftHint.value = false
      if (showRightHint.value) showRightHint.value = false
    }
  },
  16
)

const handleInitialized = (instance: OverlayScrollbars) => {
  emit("scrollReady", instance.elements().scrollOffsetElement)
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
    :class="{
      'overlay-scrollbars-wrapper--block-hints': props.showBlockHints,
      'overlay-scrollbars-wrapper--inline-hints': props.showInlineHints,
      'overlay-scrollbars-wrapper--show-top-hint': showTopHint,
      'overlay-scrollbars-wrapper--show-bottom-hint': showBottomHint,
      'overlay-scrollbars-wrapper--show-left-hint': showLeftHint,
      'overlay-scrollbars-wrapper--show-right-hint': showRightHint,
    }"
  >
    <OverlayScrollbarsComponent
      v-if="!props.targetSelector"
      ref="overlayScrollbars"
      class="overlay-scrollbars-wrapper__viewport size-full min-h-0 min-w-0 grow overflow-auto"
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
  </div>
</template>

<style scoped>
@property --overlay-scrollbars-fade-top-start {
  syntax: "<length-percentage>";
  initial-value: 0px;
  inherits: false;
}

@property --overlay-scrollbars-fade-top-end {
  syntax: "<length-percentage>";
  initial-value: 0px;
  inherits: false;
}

@property --overlay-scrollbars-fade-bottom-start {
  syntax: "<length-percentage>";
  initial-value: 100%;
  inherits: false;
}

@property --overlay-scrollbars-fade-bottom-end {
  syntax: "<length-percentage>";
  initial-value: 100%;
  inherits: false;
}

@property --overlay-scrollbars-fade-left-start {
  syntax: "<length-percentage>";
  initial-value: 0px;
  inherits: false;
}

@property --overlay-scrollbars-fade-left-end {
  syntax: "<length-percentage>";
  initial-value: 0px;
  inherits: false;
}

@property --overlay-scrollbars-fade-right-start {
  syntax: "<length-percentage>";
  initial-value: 100%;
  inherits: false;
}

@property --overlay-scrollbars-fade-right-end {
  syntax: "<length-percentage>";
  initial-value: 100%;
  inherits: false;
}

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
  --overlay-scrollbars-block-fade-stop: 16px;
  --overlay-scrollbars-inline-fade-stop: 16px;
}

:deep([data-overlayscrollbars-viewport]) {
  --overlay-scrollbars-block-mask: linear-gradient(
    to bottom,
    transparent 0%,
    transparent var(--overlay-scrollbars-fade-top-start),
    black var(--overlay-scrollbars-fade-top-end),
    black var(--overlay-scrollbars-fade-bottom-start),
    transparent var(--overlay-scrollbars-fade-bottom-end),
    transparent 100%
  );
  --overlay-scrollbars-inline-mask: linear-gradient(
    to right,
    transparent 0%,
    transparent var(--overlay-scrollbars-fade-left-start),
    black var(--overlay-scrollbars-fade-left-end),
    black var(--overlay-scrollbars-fade-right-start),
    transparent var(--overlay-scrollbars-fade-right-end),
    transparent 100%
  );
  --overlay-scrollbars-fade-top-start: 0px;
  --overlay-scrollbars-fade-top-end: 0px;
  --overlay-scrollbars-fade-bottom-start: 100%;
  --overlay-scrollbars-fade-bottom-end: 100%;
  --overlay-scrollbars-fade-left-start: 0px;
  --overlay-scrollbars-fade-left-end: 0px;
  --overlay-scrollbars-fade-right-start: 100%;
  --overlay-scrollbars-fade-right-end: 100%;
  transition:
    --overlay-scrollbars-fade-top-end 200ms ease,
    --overlay-scrollbars-fade-bottom-start 200ms ease,
    --overlay-scrollbars-fade-left-end 200ms ease,
    --overlay-scrollbars-fade-right-start 200ms ease;
}

.overlay-scrollbars-wrapper--block-hints:not(
    .overlay-scrollbars-wrapper--inline-hints
  )
  :deep([data-overlayscrollbars-viewport]) {
  mask-image: var(--overlay-scrollbars-block-mask);
  mask-repeat: no-repeat;
  mask-size: 100% 100%;
}

.overlay-scrollbars-wrapper--inline-hints:not(
    .overlay-scrollbars-wrapper--block-hints
  )
  :deep([data-overlayscrollbars-viewport]) {
  mask-image: var(--overlay-scrollbars-inline-mask);
  mask-repeat: no-repeat;
  mask-size: 100% 100%;
}

.overlay-scrollbars-wrapper--block-hints.overlay-scrollbars-wrapper--inline-hints
  :deep([data-overlayscrollbars-viewport]) {
  mask-image:
    var(--overlay-scrollbars-block-mask), var(--overlay-scrollbars-inline-mask);
  mask-repeat: no-repeat, no-repeat;
  mask-size:
    100% 100%,
    100% 100%;
  mask-composite: intersect;
}

.overlay-scrollbars-wrapper--show-top-hint
  :deep([data-overlayscrollbars-viewport]) {
  --overlay-scrollbars-fade-top-end: var(--overlay-scrollbars-block-fade-stop);
}

.overlay-scrollbars-wrapper--show-bottom-hint
  :deep([data-overlayscrollbars-viewport]) {
  --overlay-scrollbars-fade-bottom-start: calc(
    100% - var(--overlay-scrollbars-block-fade-stop)
  );
}

.overlay-scrollbars-wrapper--show-left-hint
  :deep([data-overlayscrollbars-viewport]) {
  --overlay-scrollbars-fade-left-end: var(
    --overlay-scrollbars-inline-fade-stop
  );
}

.overlay-scrollbars-wrapper--show-right-hint
  :deep([data-overlayscrollbars-viewport]) {
  --overlay-scrollbars-fade-right-start: calc(
    100% - var(--overlay-scrollbars-inline-fade-stop)
  );
}
</style>
