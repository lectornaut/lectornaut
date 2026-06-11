<script lang="ts" setup>
import { useSidebar } from "@/components/ui/sidebar"
import { useShortcutKeys } from "@/composables/useShortcutKeys"
import { useSidebarPreview } from "@/composables/useSidebarSlots"
import {
  IconPanelLeft,
  IconPanelLeftClose,
  IconPanelRight,
  IconPanelRightClose,
} from "@/data/icons"
import { emitter } from "@/modules/mitt"
import { useUiPreferencesStore } from "@/stores/uiPreferencesStore"
import { storeToRefs } from "pinia"

const props = defineProps<{ side: "left" | "right" }>()

const { t } = useI18n()
const { isMobile } = useSidebar()
const uiPreferencesStore = useUiPreferencesStore()
const { leftPanelCollapsed, rightPanelCollapsed } =
  storeToRefs(uiPreferencesStore)

const isCollapsed = computed(() =>
  props.side === "left" ? leftPanelCollapsed.value : rightPanelCollapsed.value
)

const icon = computed(() => {
  if (props.side === "left")
    return isCollapsed.value ? IconPanelLeft : IconPanelLeftClose
  return isCollapsed.value ? IconPanelRight : IconPanelRightClose
})

const tooltipLabel = computed(() =>
  props.side === "left"
    ? t("components.subNavigation.tooltips.toggleLeftSidebar")
    : t("components.subNavigation.tooltips.toggleRightSidebar")
)

const eventName = computed(() =>
  props.side === "left" ? "Sidebar.Left.Toggle" : "Sidebar.Right.Toggle"
)

const shortcutKeys = useShortcutKeys(
  props.side === "left" ? "Sidebar.Left.Toggle" : "Sidebar.Right.Toggle"
)

const toggle = () => {
  emitter.emit(eventName.value)
}

// Hover preview of the collapsed sidebar — mirrors the Tabbar → MainSidebar
// peek. The page's content lives in a <SidebarSlot> whose teleport target we
// repoint at the popover's `#{side}-sidebar-preview` div; Vue moves the live
// content there natively (see useSidebarSlots), so no DOM is relocated by hand.
const previewTargetId = `${props.side}-sidebar-preview`
const { setPreviewing } = useSidebarPreview(props.side)
const previewOpen = ref(false)
const previewEl = useTemplateRef<HTMLElement>("previewEl")

// Only previewable while the panel is collapsed (peeking an open panel is
// pointless) and off mobile.
const canPreview = computed(() => isCollapsed.value && !isMobile.value)

// The HoverCard is only rendered while `canPreview` (see template), so reka
// only emits here when previewing is allowed.
function onPreviewUpdate(open: boolean) {
  if (open) {
    // Just open the popover. The slot is teleported in by the watcher below,
    // once the popover's target actually exists in the DOM.
    previewOpen.value = true
  } else {
    // Return the content to the (always-present) panel BEFORE the popover
    // unmounts, so the live node is never stranded in a dying popover.
    setPreviewing(false)
    previewOpen.value = false
  }
}

// Repoint the page's <SidebarSlot> into the popover the instant its target
// mounts. A Teleport resolves a changed target synchronously, so flipping on a
// guessed nextTick can race the popover's own mount; keying off the real DOM
// node removes the race entirely.
watch(previewEl, (el) => {
  if (el) setPreviewing(true)
})

// If the panel expands (or we hit mobile) while previewing, tear the peek down.
watch(canPreview, (ok) => {
  if (!ok && previewOpen.value) {
    setPreviewing(false)
    previewOpen.value = false
  }
})
</script>

<template>
  <!--
    Two single-trigger shapes, never nested: nesting <HoverCardTrigger> and
    <TooltipTrigger> on one button drops the outer trigger's hover listeners
    (reka's Primitive is inheritAttrs:false), so the card never opened.
    Collapsed → rich preview card; otherwise → the plain label tooltip.
  -->
  <HoverCard
    v-if="canPreview"
    :open="previewOpen"
    :open-delay="500"
    :close-delay="0"
    @update:open="onPreviewUpdate"
  >
    <HoverCardTrigger as-child>
      <Button variant="outline" size="icon" @click="toggle">
        <slot><Component :is="icon" /></slot>
      </Button>
    </HoverCardTrigger>
    <HoverCardContent
      side="bottom"
      :align="side === 'left' ? 'start' : 'end'"
      :side-offset="8"
      class="h-[80svh] w-80 overflow-clip p-0"
    >
      <div :id="previewTargetId" ref="previewEl" class="flex size-full" />
    </HoverCardContent>
  </HoverCard>

  <Tooltip v-else>
    <TooltipTrigger as-child>
      <Button variant="outline" size="icon" @click="toggle">
        <slot><Component :is="icon" /></slot>
      </Button>
    </TooltipTrigger>
    <TooltipContent class="flex items-center gap-2 pr-2">
      <slot name="tooltip">{{ tooltipLabel }}</slot>
      <KbdGroup v-if="shortcutKeys?.length">
        <Kbd v-for="key in shortcutKeys" :key="key" aria-hidden="true">{{
          key
        }}</Kbd>
      </KbdGroup>
    </TooltipContent>
  </Tooltip>
</template>
