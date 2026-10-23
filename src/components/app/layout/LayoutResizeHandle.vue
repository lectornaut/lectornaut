<script setup lang="ts">
import {
  IconArrowBigUp,
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconHand,
  IconPointerClick,
} from "@/data/icons"
import type { SplitterResizeHandleProps } from "reka-ui"
import type { HTMLAttributes } from "vue"

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes["class"]
    direction?: "horizontal" | "vertical"
    side?: "left" | "right" | "bottom"
    collapsed?: boolean
    disabled?: SplitterResizeHandleProps["disabled"]
    visible?: boolean
    fade?: boolean
  }>(),
  {
    direction: "horizontal",
    side: "right",
    collapsed: false,
    disabled: false,
    visible: true,
    fade: false,
  }
)

const { t } = useI18n()
const isVertical = computed(() => props.direction === "vertical")
const expandIcon = computed(() =>
  isVertical.value
    ? IconArrowUp
    : props.side === "left"
      ? IconArrowLeft
      : IconArrowRight
)
const collapseIcon = computed(() =>
  isVertical.value
    ? IconArrowDown
    : props.side === "left"
      ? IconArrowRight
      : IconArrowLeft
)
const expandLabel = computed(() =>
  isVertical.value
    ? t("tooltips.upArrowExpand")
    : props.side === "left"
      ? t("tooltips.leftArrowExpand")
      : t("tooltips.rightArrowExpand")
)
const collapseLabel = computed(() =>
  isVertical.value
    ? t("tooltips.downArrowCollapse")
    : props.side === "left"
      ? t("tooltips.rightArrowCollapse")
      : t("tooltips.leftArrowCollapse")
)
</script>

<template>
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger as-child>
        <ResizableHandle
          v-show="visible"
          v-motion
          :initial="{ opacity: fade ? 0 : 1 }"
          :enter="{ opacity: 1 }"
          v-bind="$attrs"
          :disabled="disabled"
          :data-collapsed="collapsed ? '' : undefined"
          :class="[
            'layout-resize-handle z-20 bg-transparent after:rounded-3xl focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none',
            props.class,
          ]"
        />
      </TooltipTrigger>
      <TooltipContent :side="side" class="p-1!">
        <div class="flex flex-col gap-1">
          <div class="bg-accent/5 flex flex-col gap-2 rounded-lg p-2">
            <span class="flex items-center gap-2">
              <IconHand /> {{ t("tooltips.dragToResize") }}
            </span>
            <span class="flex items-center gap-2">
              <IconPointerClick /> {{ t("tooltips.doubleClickToggle") }}
            </span>
          </div>
          <div class="bg-accent/5 flex flex-col gap-2 rounded-lg p-2">
            <span class="flex items-center gap-2">
              <Component :is="expandIcon" /> {{ expandLabel }}
            </span>
            <span class="flex items-center gap-2">
              <Component :is="collapseIcon" /> {{ collapseLabel }}
            </span>
            <span class="flex items-center gap-2">
              <IconArrowBigUp /> {{ t("tooltips.shiftLargeSteps") }}
            </span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>

<style scoped>
.layout-resize-handle::before {
  content: "";
  position: absolute;
  pointer-events: auto;
}

.layout-resize-handle:is(
    :focus-visible,
    [data-resize-handle-state="hover"]
  )::after {
  background-color: var(--muted);
}

.layout-resize-handle[data-resize-handle-state="drag"]::after {
  background-color: var(--foreground);
}

.layout-resize-handle[data-orientation="horizontal"]::before {
  inset: 0 auto 0 50%;
  width: calc(var(--spacing) * 3);
  translate: -50% 0;
}

.layout-resize-handle[data-orientation="horizontal"]:is(
    :focus-visible,
    [data-resize-handle-state="hover"],
    [data-resize-handle-state="drag"]
  )::after {
  top: calc(var(--spacing) * 6);
  bottom: calc(var(--spacing) * 6);
}

.layout-resize-handle[data-orientation="horizontal"][data-collapsed] {
  width: 0;
}

.layout-resize-handle[data-orientation="vertical"]::before {
  inset: 50% 0 auto;
  height: calc(var(--spacing) * 3);
  translate: 0 -50%;
}

.layout-resize-handle[data-orientation="vertical"]::after {
  top: 50%;
  bottom: auto;
}

.layout-resize-handle[data-orientation="vertical"]:is(
    :focus-visible,
    [data-resize-handle-state="hover"],
    [data-resize-handle-state="drag"]
  )::after {
  right: calc(var(--spacing) * 6);
  left: calc(var(--spacing) * 6);
  width: auto;
}

.layout-resize-handle[data-orientation="vertical"][data-collapsed] {
  height: 0;
}
</style>
