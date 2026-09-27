<script lang="ts" setup>
import type { ChartConfig } from "@/components/ui/chart"
import { ChartContainer } from "@/components/ui/chart"
import { useTeamUsage } from "@/composables/useTeamUsage"
import { emitMainWindowIntent } from "@/modules/mitt"
import { VisDonut, VisSingleContainer } from "@unovis/vue"

const { t, n } = useI18n()
const {
  canReadUsage,
  effectiveLimit,
  isExhausted,
  isLoading,
  isUnlimited,
  percentUsed,
  used,
} = useTeamUsage()

const usageText = computed(() => {
  if (isLoading.value) return "..."
  return isUnlimited.value
    ? t("settings.usage.thisMonth.remainingUnlimited")
    : `${Math.round(percentUsed.value)}%`
})

const usageDescription = computed(() => {
  if (isUnlimited.value) {
    return t("settings.usage.thisMonth.unlimited", { used: n(used.value) })
  }
  return t("settings.usage.thisMonth.progress.description", {
    used: n(used.value),
    limit: n(effectiveLimit.value),
  })
})

interface UsageSlice {
  key: "used" | "remaining"
  value: number
}

const chartConfig = computed(
  () =>
    ({
      used: {
        label: t("settings.usage.thisMonth.stats.used"),
        color: "var(--color-chart-1)",
      },
      remaining: {
        label: t("settings.usage.thisMonth.stats.remaining"),
        color: "var(--muted)",
      },
    }) satisfies ChartConfig
)

const usageSlices = computed<UsageSlice[]>(() => [
  { key: "used", value: used.value },
  {
    key: "remaining",
    value: Math.max(0, effectiveLimit.value - used.value),
  },
])

// Unovis can retain the single-container series when its parent receives a
// freshly-computed data array. Keying the chart to the values makes a Firestore
// usage update replace the internal donut data as soon as it arrives.
const usageChartKey = computed(
  () => `${used.value}:${Math.max(0, effectiveLimit.value - used.value)}`
)

const usageSliceColor = (slice: UsageSlice): string =>
  chartConfig.value[slice.key]?.color ?? "var(--muted)"

const usageButtonVariant = computed(() =>
  isExhausted.value ? "destructive" : "ghost"
)

const openUsageSettings = async (): Promise<void> => {
  try {
    await emitMainWindowIntent("Dialog.Settings.Open", "usage")
  } catch (error) {
    console.error("[BotUsageCounter] Failed to open usage settings:", error)
  }
}
</script>

<template>
  <TooltipProvider v-if="canReadUsage">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          :variant="usageButtonVariant"
          size="sm"
          class="ml-auto"
          @click="openUsageSettings"
        >
          <InputGroupText class="font-mono text-xs tabular-nums">
            {{ usageText }}
          </InputGroupText>
          <ChartContainer :config="chartConfig" class="size-5 shrink-0">
            <VisSingleContainer :key="usageChartKey" :data="usageSlices">
              <VisDonut
                :value="(slice: UsageSlice) => slice.value"
                :color="usageSliceColor"
                :radius="6"
                :arc-width="2"
                :show-background="false"
              />
            </VisSingleContainer>
          </ChartContainer>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {{ usageDescription }}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
