<script lang="ts" setup>
import type { ChartConfig } from "@/components/ui/chart"
import { ChartContainer } from "@/components/ui/chart"
import { requestUsageIncrease } from "@/composables/useFunctions"
import { useTeamUsage } from "@/composables/useTeamUsage"
import { emitMainWindowIntent } from "@/modules/mitt"
import { useTeamStore } from "@/stores/teamStore"
import { VisDonut, VisSingleContainer } from "@unovis/vue"
import { storeToRefs } from "pinia"
import { toast } from "vue-sonner"

const { t, n } = useI18n()
const {
  canReadUsage,
  effectiveLimit,
  isExhausted,
  isLoading,
  isUnlimited,
  monthKey,
  percentUsed,
  used,
} = useTeamUsage()
const { currentTeam } = storeToRefs(useTeamStore())

// Members can't read the usage doc; the budget gate mirrors "limit hit" onto
// the team doc, so that flag is all a member ever sees of usage.
const isMemberExhausted = computed(
  () =>
    !canReadUsage.value && currentTeam.value?.usageExhaustedMonth === monthKey
)

const isTooltipOpen = ref(false)
const requestState = ref<"idle" | "sending" | "sent">("idle")

const requestAdminForUsage = async (): Promise<void> => {
  const teamId = currentTeam.value?.id
  if (!teamId || requestState.value !== "idle") return
  requestState.value = "sending"
  try {
    await requestUsageIncrease({ teamId })
    requestState.value = "sent"
    toast.success(t("settings.usage.thisMonth.requestSent"))
  } catch (error) {
    console.error("[BotUsageCounter] requestUsageIncrease failed:", error)
    requestState.value = "idle"
    toast.error(t("settings.usage.thisMonth.requestFailed"))
  }
}

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
  <TooltipProvider v-if="isMemberExhausted">
    <Tooltip v-model:open="isTooltipOpen">
      <TooltipTrigger as-child>
        <Button
          variant="destructive"
          size="sm"
          class="ml-auto"
          @click="isTooltipOpen = true"
        >
          <InputGroupText class="text-xs">
            {{ t("settings.usage.thisMonth.limitReached") }}
          </InputGroupText>
        </Button>
      </TooltipTrigger>
      <TooltipContent class="flex flex-col items-start gap-2 py-2">
        {{ t("settings.usage.thisMonth.memberExhausted") }}
        <Button
          variant="secondary"
          size="xs"
          :disabled="requestState !== 'idle'"
          @click="requestAdminForUsage"
        >
          <Spinner v-if="requestState === 'sending'" />
          {{
            requestState === "sent"
              ? t("settings.usage.thisMonth.requested")
              : t("settings.usage.thisMonth.requestAdmin")
          }}
        </Button>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
  <TooltipProvider v-else-if="canReadUsage">
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
