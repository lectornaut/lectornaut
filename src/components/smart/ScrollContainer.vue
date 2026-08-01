<script lang="ts" setup>
const props = withDefaults(
  defineProps<{
    showBlockHints?: boolean
    showInlineHints?: boolean
  }>(),
  {
    showBlockHints: true,
    showInlineHints: false,
  }
)

const viewport = useTemplateRef<HTMLElement>("viewport")

// Same contract the OverlayScrollbars-era wrapper exposed; consumers feed
// this to useInfiniteScroll. With native scrolling the component root IS the
// scroll element.
defineExpose({
  getScrollElement: () => viewport.value ?? undefined,
})
</script>

<template>
  <!-- Native scroll viewport. The scroll-fade-* utilities (shadcn-vue/tailwind.css)
       carry the edge "more content" hints via scroll-driven CSS animations —
       no scroll listeners, no measurement, no library. `flex-col` matches the
       column flex context the old OverlayScrollbars content element imposed,
       so slot layouts (grow/stretch children) behave identically. -->
  <div
    ref="viewport"
    class="relative flex size-full min-h-0 min-w-0 grow scrollbar-thin scrollbar-gutter-stable flex-col overflow-auto overscroll-contain [contain:layout_style]"
    :class="{
      'scroll-fade': props.showBlockHints && props.showInlineHints,
      'scroll-fade-y': props.showBlockHints && !props.showInlineHints,
      'scroll-fade-x': !props.showBlockHints && props.showInlineHints,
    }"
  >
    <slot />
  </div>
</template>
