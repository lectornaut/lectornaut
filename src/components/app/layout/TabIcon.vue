<script lang="ts" setup>
import { resolveTabIcon } from "@/helpers/tabIcons"
import type { LayoutTabIndicator } from "@/types/layout"

const props = withDefaults(
  defineProps<{
    fullPath: string
    indicator?: LayoutTabIndicator | null
  }>(),
  {
    indicator: null,
  }
)

const indicatorToneClasses = {
  neutral: "bg-muted-foreground",
  info: "bg-sky-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-destructive",
} as const

const resolvedIcon = computed(() => resolveTabIcon(props.fullPath).icon)
const indicatorToneClass = computed(
  () => indicatorToneClasses[props.indicator?.tone ?? "neutral"]
)
</script>

<template>
  <span class="relative shrink-0">
    <Component :is="resolvedIcon" />
    <span
      v-if="indicator"
      class="bg-background ring-background absolute -top-2 -left-3 flex size-2.5 items-center justify-center rounded-full ring-2"
    >
      <span
        :class="[
          'block size-2 rounded-full',
          indicatorToneClass,
          {
            'animate-pulse': indicator.pulse,
            'animate-spin': indicator.spin,
          },
        ]"
      />
    </span>
  </span>
</template>
