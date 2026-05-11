<script lang="ts" setup>
import { useShortcutKeys } from "@/composables/useShortcutKeys"
import {
  IconPanelLeft,
  IconPanelLeftClose,
  IconPanelRight,
  IconPanelRightClose,
} from "@/data/icons"
import { emitter } from "@/modules/mitt"
import { useLayoutStore } from "@/stores/layoutStore"
import { storeToRefs } from "pinia"

const props = defineProps<{ side: "left" | "right" }>()

const { t } = useI18n()
const layoutStore = useLayoutStore()
const { leftPanelCollapsed, rightPanelCollapsed } = storeToRefs(layoutStore)

const isCollapsed = computed(() =>
  props.side === "left" ? leftPanelCollapsed.value : rightPanelCollapsed.value
)

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
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <Button variant="outline" size="icon" @click="toggle">
        <slot>
          <template v-if="side === 'left'">
            <IconPanelLeft v-if="isCollapsed" />
            <IconPanelLeftClose v-else />
          </template>
          <template v-else>
            <IconPanelRight v-if="isCollapsed" />
            <IconPanelRightClose v-else />
          </template>
        </slot>
      </Button>
    </TooltipTrigger>
    <TooltipContent class="flex items-center gap-2 pr-2">
      <slot name="tooltip">{{ tooltipLabel }}</slot>
      <KbdGroup v-if="shortcutKeys?.length">
        <Kbd v-for="key in shortcutKeys" :key="key">{{ key }}</Kbd>
      </KbdGroup>
    </TooltipContent>
  </Tooltip>
</template>
