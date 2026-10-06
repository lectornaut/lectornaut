<script lang="ts" setup>
/**
 * Settings → Usage: the ONE place for AI spend.
 *
 *  - Reads this month's `teams/{teamId}/usage/{YYYY-MM}` doc (written by the
 *    server-side metering middleware; admin-readable per firestore.rules).
 *  - Shows the plan allowance (`PLAN_TOKEN_ALLOWANCES`, shared/domain.ts), the
 *    team's optional token cap, and its optional estimated-cost cap.
 *  - The cap is free-text, so it's staged and committed via SettingsUnsavedBar
 *    (toggles apply immediately; typed values get a save/discard footer).
 *
 * Automatic workflows have no separate entitlement gate any more — this
 * monthly limit is the only spend control, for chat AND workflow runs.
 */
import type { ChartConfig } from "@/components/ui/chart"
import {
  ChartContainer,
  ChartCrosshair,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  componentToString,
} from "@/components/ui/chart"
import { useAgentConfig } from "@/composables/useAgentConfig"
import { useCanViewTeamSettings } from "@/composables/useCanViewTeamSettings"
import { useTeamActions } from "@/composables/useTeamActions"
import {
  toUsageMonthKey,
  useTeamUsage,
  type TeamUsageDoc,
} from "@/composables/useTeamUsage"
import { IconGauge } from "@/data/icons"
import { firestore } from "@/modules/firebase"
import { emitter } from "@/modules/mitt"
import { useAuthStore } from "@/stores/authStore"
import { useCollectionQuery } from "@/utils/firebase/firebase-query"
import {
  MONTHLY_COST_CAP_MIN_CENTS,
  MONTHLY_TOKEN_CAP_MIN,
} from "@lectornaut/shared/domain"
import { VisAxis, VisStackedBar, VisXYContainer } from "@unovis/vue"
import { collection, documentId, query, where } from "firebase/firestore"
import { storeToRefs } from "pinia"

const { t, n, locale } = useI18n()
const { canViewTeamSettings } = useCanViewTeamSettings()
const { canManageBilling } = useTeamActions()
const { currentTeamId } = storeToRefs(useAuthStore())

const { config, isLoading, isSaving, canEdit, save } = useAgentConfig(() => ({
  permissionRequired: t("settings.usage.teamCap.permissionRequired"),
  saveSuccess: t("settings.usage.teamCap.saveSuccess"),
  saveError: t("settings.usage.teamCap.saveError"),
  loadError: t("settings.usage.teamCap.loadError"),
}))

// ── This month's metered usage (single source: useTeamUsage) ─────────────────
const {
  used,
  turnCount,
  estimatedCostUsd,
  planKey,
  planAllowance,
  effectiveLimit,
  isUnlimited,
  percentUsed,
  isExhausted,
  isCapAbovePlan,
  costAllowanceUsd,
  costRemainingUsd,
  isCostLimited,
  costPercentUsed,
} = useTeamUsage()
const averageTokensPerTurn = computed(() =>
  turnCount.value > 0 ? Math.round(used.value / turnCount.value) : 0
)
const remainingTokens = computed(() =>
  isUnlimited.value ? 0 : Math.max(0, effectiveLimit.value - used.value)
)
const formatUsd = (value: number): string =>
  new Intl.NumberFormat(locale.value, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value)

// "Upgrade plan" sits next to every limit we show; enterprise is the top plan.
const canUpgrade = computed(
  () => canManageBilling.value && planKey.value !== "enterprise"
)
const openPlans = (): void => {
  emitter.emit("Dialog.Settings.Open", "plans")
}

// ── Monthly history (last 12 months, input vs output) ────────────────────────
// One usage doc per month, so the honest time series is monthly. Months with
// no doc render as zero so the axis stays a fixed twelve-month timeline.
const HISTORY_MONTHS = 12
const historyMonths: Date[] = (() => {
  const now = new Date()
  return Array.from(
    { length: HISTORY_MONTHS },
    (_, i) =>
      new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth() - (HISTORY_MONTHS - 1 - i),
          1
        )
      )
  )
})()
const oldestMonthKey = toUsageMonthKey(historyMonths[0]!)

const historySource = computed(() => {
  const id = currentTeamId.value
  if (!id) return null
  const path = `teams/${id}/usage`
  return {
    query: query(
      collection(firestore, path),
      where(documentId(), ">=", oldestMonthKey)
    ),
    path,
    params: { since: oldestMonthKey },
  }
})
const { data: usageHistory } = useCollectionQuery<TeamUsageDoc>(historySource, {
  enabled: canEdit,
})

interface UsageRow {
  date: Date
  input: number
  output: number
}
const historyRows = computed<UsageRow[]>(() => {
  const byMonth = new Map<string, TeamUsageDoc>()
  for (const row of usageHistory.value ?? []) {
    if (row.month) byMonth.set(row.month, row)
  }
  return historyMonths.map((date) => {
    const row = byMonth.get(toUsageMonthKey(date))
    return {
      date,
      input: row?.inputTokens ?? 0,
      output: row?.outputTokens ?? 0,
    }
  })
})
const hasHistory = computed(() =>
  historyRows.value.some((r) => r.input + r.output > 0)
)

const chartConfig = computed(
  () =>
    ({
      input: {
        label: t("settings.usage.history.input"),
        color: "var(--color-chart-1)",
      },
      output: {
        label: t("settings.usage.history.output"),
        color: "var(--color-chart-3)",
      },
    }) satisfies ChartConfig
)
const monthShortLabels = new Map(
  historyMonths.map((d) => [d.getTime(), useDateFormat(d, "MMM").value])
)
const monthLongLabels = new Map(
  historyMonths.map((d) => [d.getTime(), useDateFormat(d, "MMMM YYYY").value])
)

// ── Team cap (staged free-text) ──────────────────────────────────────────────
const toInput = (cap: number | null): string =>
  cap === null ? "" : String(cap)
const capInput = ref(toInput(config.value.monthlyTokenCap))
const toCostInput = (capCents: number | null): string =>
  capCents === null ? "" : String(capCents / 100).replace(/\.00$/, "")
const costCapInput = ref(toCostInput(config.value.monthlyCostCapCents))

const draftCap = computed<number | null>(() => {
  const trimmed = capInput.value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? Math.floor(parsed) : Number.NaN
})
const isCapInvalid = computed(
  () =>
    draftCap.value !== null &&
    (Number.isNaN(draftCap.value) || draftCap.value < MONTHLY_TOKEN_CAP_MIN)
)
const draftCostCapCents = computed<number | null>(() => {
  const trimmed = costCapInput.value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : Number.NaN
})
const isCostCapInvalid = computed(
  () =>
    draftCostCapCents.value !== null &&
    (Number.isNaN(draftCostCapCents.value) ||
      draftCostCapCents.value < MONTHLY_COST_CAP_MIN_CENTS)
)
const isDirty = computed(() => {
  if (Number.isNaN(draftCap.value)) return true
  if (Number.isNaN(draftCostCapCents.value)) return true
  return (
    draftCap.value !== config.value.monthlyTokenCap ||
    draftCostCapCents.value !== config.value.monthlyCostCapCents
  )
})
const isDraftBelowUsage = computed(
  () =>
    draftCap.value !== null &&
    !Number.isNaN(draftCap.value) &&
    draftCap.value >= MONTHLY_TOKEN_CAP_MIN &&
    draftCap.value <= used.value
)
const isDraftCostBelowUsage = computed(
  () =>
    draftCostCapCents.value !== null &&
    !Number.isNaN(draftCostCapCents.value) &&
    draftCostCapCents.value <= Math.round(estimatedCostUsd.value * 100)
)

// Slider: bounded by the plan allowance, so the number has its context. The
// far-right stop IS "no team limit" (the plan allowance applies), which keeps
// the empty-input and the slider-at-max states the same thing.
const hasCeiling = computed(() => planAllowance.value >= 0)
// ~100 stops across the allowance, snapped to a round power of ten.
const sliderStep = computed(() => {
  if (!hasCeiling.value) return MONTHLY_TOKEN_CAP_MIN
  return Math.max(
    MONTHLY_TOKEN_CAP_MIN,
    10 ** Math.floor(Math.log10(planAllowance.value / 100))
  )
})
const sliderValue = computed(() => {
  const cap = draftCap.value
  if (cap === null || Number.isNaN(cap)) return planAllowance.value
  return Math.min(Math.max(cap, MONTHLY_TOKEN_CAP_MIN), planAllowance.value)
})
const handleSlider = (value: number[] | undefined): void => {
  const next = value?.[0]
  if (next === undefined) return
  capInput.value = next >= planAllowance.value ? "" : String(next)
}
const draftShareOfPlan = computed(() => {
  if (!hasCeiling.value || planAllowance.value === 0) return 0
  return Math.round((sliderValue.value / planAllowance.value) * 100)
})

// Re-sync the field when the server value changes underneath an untouched draft.
watch(
  () => config.value.monthlyTokenCap,
  (next) => {
    if (!isDirty.value) capInput.value = toInput(next)
  }
)
watch(
  () => config.value.monthlyCostCapCents,
  (next) => {
    if (!isDirty.value) costCapInput.value = toCostInput(next)
  }
)

const handleSave = async (): Promise<void> => {
  if (isCapInvalid.value || isCostCapInvalid.value) return
  await save({
    monthlyTokenCap: draftCap.value,
    monthlyCostCapCents: draftCostCapCents.value,
  })
}
const handleDiscard = (): void => {
  capInput.value = toInput(config.value.monthlyTokenCap)
  costCapInput.value = toCostInput(config.value.monthlyCostCapCents)
}
</script>

<template>
  <div v-if="canViewTeamSettings" class="flex grow flex-col justify-between">
    <div class="p-6">
      <LoadingState v-if="isLoading" />
      <FieldGroup v-else>
        <FieldSet>
          <Field v-if="!canEdit" orientation="horizontal">
            <FieldContent>
              <Empty class="border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <IconGauge />
                  </EmptyMedia>
                  <EmptyTitle>
                    {{ t("settings.usage.noPermissionTitle") }}
                  </EmptyTitle>
                  <EmptyDescription>
                    {{ t("settings.usage.noPermissionDescription") }}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </FieldContent>
          </Field>

          <template v-else>
            <!-- Meter -->
            <Field>
              <FieldContent>
                <FieldLabel>{{
                  t("settings.usage.thisMonth.label")
                }}</FieldLabel>
                <FieldDescription>
                  {{ t("settings.usage.thisMonth.description") }}
                </FieldDescription>
              </FieldContent>
              <div class="flex flex-col gap-2">
                <div class="grid gap-2 @md:grid-cols-5">
                  <Card class="shadow-none">
                    <CardContent class="p-4">
                      <p class="text-muted-foreground text-sm">
                        {{ t("settings.usage.thisMonth.stats.available") }}
                      </p>
                      <p class="text-xl font-semibold tabular-nums">
                        {{
                          isUnlimited
                            ? t("settings.usage.thisMonth.remainingUnlimited")
                            : n(effectiveLimit)
                        }}
                      </p>
                    </CardContent>
                  </Card>
                  <Card class="shadow-none">
                    <CardContent class="p-4">
                      <p class="text-muted-foreground text-sm">
                        {{ t("settings.usage.thisMonth.stats.used") }}
                      </p>
                      <p class="text-xl font-semibold tabular-nums">
                        {{ n(used) }}
                      </p>
                    </CardContent>
                  </Card>
                  <Card class="shadow-none">
                    <CardContent class="p-4">
                      <p class="text-muted-foreground text-sm">
                        {{ t("settings.usage.thisMonth.stats.turns") }}
                      </p>
                      <p class="text-xl font-semibold tabular-nums">
                        {{ n(turnCount) }}
                      </p>
                    </CardContent>
                  </Card>
                  <Card class="shadow-none">
                    <CardContent class="p-4">
                      <p class="text-muted-foreground text-sm">
                        {{ t("settings.usage.thisMonth.stats.average") }}
                      </p>
                      <p class="text-xl font-semibold tabular-nums">
                        {{ n(averageTokensPerTurn) }}
                      </p>
                    </CardContent>
                  </Card>
                  <Card class="shadow-none">
                    <CardContent class="p-4">
                      <p class="text-muted-foreground text-sm">
                        {{ t("settings.usage.thisMonth.stats.remaining") }}
                      </p>
                      <p class="text-xl font-semibold tabular-nums">
                        {{
                          isUnlimited
                            ? t("settings.usage.thisMonth.remainingUnlimited")
                            : n(remainingTokens)
                        }}
                      </p>
                    </CardContent>
                  </Card>
                </div>
                <Card v-if="!isUnlimited" class="shadow-none">
                  <CardHeader class="pb-3">
                    <CardTitle>
                      {{ t("settings.usage.thisMonth.progress.label") }}
                    </CardTitle>
                    <CardDescription class="tabular-nums">
                      {{
                        t("settings.usage.thisMonth.progress.description", {
                          used: n(used),
                          limit: n(effectiveLimit),
                        })
                      }}
                    </CardDescription>
                  </CardHeader>
                  <CardContent class="pt-0">
                    <Progress :model-value="percentUsed" />
                  </CardContent>
                </Card>
                <Card class="shadow-none">
                  <CardHeader class="pb-3">
                    <CardTitle>
                      {{ t("settings.usage.costUsage.label") }}
                    </CardTitle>
                    <CardDescription>
                      {{ t("settings.usage.costUsage.description") }}
                    </CardDescription>
                  </CardHeader>
                  <CardContent class="pt-0">
                    <div
                      v-if="isCostLimited"
                      class="flex items-center gap-4 text-sm tabular-nums"
                    >
                      <Progress :model-value="costPercentUsed" class="grow" />
                      <span class="text-muted-foreground">
                        {{
                          t("settings.usage.costUsage.ofLimit", {
                            used: formatUsd(estimatedCostUsd),
                            limit: formatUsd(costAllowanceUsd),
                          })
                        }}
                      </span>
                    </div>
                    <div
                      v-else
                      class="text-muted-foreground text-sm tabular-nums"
                    >
                      {{
                        t("settings.usage.costUsage.noLimit", {
                          used: formatUsd(estimatedCostUsd),
                        })
                      }}
                    </div>
                  </CardContent>
                </Card>
                <div
                  v-if="isUnlimited"
                  class="text-muted-foreground text-sm tabular-nums"
                >
                  {{
                    t("settings.usage.thisMonth.unlimited", {
                      used: n(used),
                    })
                  }}
                </div>
                <FieldError v-if="isExhausted">
                  {{ t("settings.usage.thisMonth.exhausted") }}
                </FieldError>
              </div>
            </Field>

            <FieldSeparator />

            <!-- Plan allowance + the way out of it -->
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel>
                  {{ t("settings.usage.planAllowance.label") }}
                </FieldLabel>
                <FieldDescription>
                  {{
                    t("settings.usage.planAllowance.description", {
                      plan: t(
                        `settings.plans.subscriptionPlan.${planKey ?? "personal"}.title`
                      ),
                      limit:
                        planAllowance < 0
                          ? t("settings.usage.planAllowance.unlimited")
                          : n(planAllowance),
                    })
                  }}
                </FieldDescription>
              </FieldContent>
              <Button
                v-if="canUpgrade"
                variant="outline"
                size="sm"
                @click="openPlans"
              >
                {{ t("settings.usage.planAllowance.upgrade") }}
              </Button>
            </Field>

            <FieldSeparator />

            <!-- Team cap -->
            <Field :data-invalid="isCapInvalid">
              <FieldContent>
                <FieldLabel for="usage-team-cap">
                  {{ t("settings.usage.teamCap.label") }}
                </FieldLabel>
                <FieldDescription>
                  {{ t("settings.usage.teamCap.description") }}
                </FieldDescription>
                <FieldError v-if="isCapInvalid">
                  {{
                    t("settings.usage.teamCap.hint", {
                      min: n(MONTHLY_TOKEN_CAP_MIN),
                    })
                  }}
                </FieldError>
                <FieldError v-else-if="isDraftBelowUsage">
                  {{ t("settings.usage.teamCap.belowUsage") }}
                </FieldError>
                <FieldDescription v-else-if="isCapAbovePlan">
                  {{
                    t("settings.usage.teamCap.abovePlan", {
                      limit: n(planAllowance),
                    })
                  }}
                </FieldDescription>
                <FieldDescription class="tabular-nums">
                  <template v-if="!hasCeiling">
                    {{ t("settings.usage.teamCap.noCeiling") }}
                  </template>
                  <template v-else-if="draftCap === null">
                    {{
                      t("settings.usage.teamCap.atPlan", {
                        limit: n(planAllowance),
                      })
                    }}
                  </template>
                  <template v-else>
                    {{
                      t("settings.usage.teamCap.share", {
                        percent: draftShareOfPlan,
                        limit: n(planAllowance),
                      })
                    }}
                  </template>
                  {{ t("settings.usage.teamCap.usedSoFar", { used: n(used) }) }}
                </FieldDescription>
              </FieldContent>
              <div class="flex flex-col gap-2">
                <div class="flex items-center justify-end gap-4">
                  <Slider
                    v-if="hasCeiling"
                    :model-value="[sliderValue]"
                    :min="MONTHLY_TOKEN_CAP_MIN"
                    :max="planAllowance"
                    :step="sliderStep"
                    :disabled="isSaving"
                    :aria-label="t('settings.usage.teamCap.label')"
                    class="grow"
                    @update:model-value="handleSlider"
                  />
                  <Input
                    id="usage-team-cap"
                    v-model="capInput"
                    type="number"
                    inputmode="numeric"
                    :min="MONTHLY_TOKEN_CAP_MIN"
                    :step="sliderStep"
                    :placeholder="t('settings.usage.teamCap.placeholder')"
                    :disabled="isSaving"
                    :aria-invalid="isCapInvalid"
                    class="w-40 shrink-0"
                  />
                </div>
              </div>
            </Field>

            <!-- Estimated cost cap -->
            <Field orientation="horizontal" :data-invalid="isCostCapInvalid">
              <FieldContent class="min-w-0">
                <FieldLabel for="usage-cost-cap">
                  {{ t("settings.usage.costCap.label") }}
                </FieldLabel>
                <FieldDescription>
                  {{ t("settings.usage.costCap.description") }}
                </FieldDescription>
                <FieldError v-if="isCostCapInvalid">
                  {{
                    t("settings.usage.costCap.hint", {
                      min: formatUsd(MONTHLY_COST_CAP_MIN_CENTS / 100),
                    })
                  }}
                </FieldError>
                <FieldError v-else-if="isDraftCostBelowUsage">
                  {{ t("settings.usage.costCap.belowUsage") }}
                </FieldError>
                <FieldDescription class="tabular-nums">
                  {{
                    t("settings.usage.costCap.usedSoFar", {
                      used: formatUsd(estimatedCostUsd),
                      remaining: isCostLimited
                        ? formatUsd(costRemainingUsd)
                        : t("settings.usage.costCap.noLimit"),
                    })
                  }}
                </FieldDescription>
              </FieldContent>
              <div class="flex flex-col gap-2">
                <div class="flex items-center justify-end gap-4">
                  <Input
                    id="usage-cost-cap"
                    v-model="costCapInput"
                    type="number"
                    inputmode="decimal"
                    :min="MONTHLY_COST_CAP_MIN_CENTS / 100"
                    step="0.01"
                    :placeholder="t('settings.usage.costCap.placeholder')"
                    :disabled="isSaving"
                    :aria-invalid="isCostCapInvalid"
                    class="w-40 shrink-0"
                  />
                </div>
              </div>
            </Field>

            <FieldSeparator />

            <!-- Monthly history -->
            <Field>
              <Card class="shadow-none">
                <CardHeader>
                  <CardTitle>{{ t("settings.usage.history.label") }}</CardTitle>
                  <CardDescription>
                    {{ t("settings.usage.history.description") }}
                  </CardDescription>
                </CardHeader>
                <CardContent class="pt-6">
                  <p v-if="!hasHistory" class="text-muted-foreground text-sm">
                    {{ t("settings.usage.history.empty") }}
                  </p>
                  <ChartContainer :config="chartConfig" class="h-46 w-full">
                    <template v-if="hasHistory">
                      <VisXYContainer :data="historyRows">
                        <VisStackedBar
                          :x="(d: UsageRow) => d.date"
                          :y="[
                            (d: UsageRow) => d.input,
                            (d: UsageRow) => d.output,
                          ]"
                          :color="[
                            chartConfig.input.color,
                            chartConfig.output.color,
                          ]"
                          bar-padding="0.1"
                          :rounded-corners="4"
                        />
                        <VisAxis
                          type="x"
                          :x="(d: UsageRow) => d.date"
                          :tick-line="false"
                          :domain-line="false"
                          :grid-line="false"
                          :tick-format="
                            (d: number) =>
                              monthShortLabels.get(new Date(d).getTime()) ?? ''
                          "
                          :tick-values="historyRows.map((r) => r.date)"
                        />
                        <ChartTooltip />
                        <ChartCrosshair
                          :template="
                            componentToString(
                              chartConfig,
                              ChartTooltipContent,
                              {
                                labelFormatter(d) {
                                  return (
                                    monthLongLabels.get(
                                      new Date(d).getTime()
                                    ) ?? ''
                                  )
                                },
                              }
                            )
                          "
                          :x="(d: UsageRow) => d.date"
                          :y="[
                            (d: UsageRow) => d.input,
                            (d: UsageRow) => d.output,
                          ]"
                          :color="[
                            chartConfig.input.color,
                            chartConfig.output.color,
                          ]"
                        />
                      </VisXYContainer>
                      <ChartLegendContent />
                    </template>
                  </ChartContainer>
                </CardContent>
              </Card>
            </Field>
          </template>
        </FieldSet>
      </FieldGroup>
    </div>

    <Transition
      enter-active-class="transition duration-200 ease-out"
      leave-active-class="transition duration-150 ease-in"
      enter-from-class="translate-y-2 opacity-0"
      leave-to-class="translate-y-2 opacity-0"
    >
      <SettingsUnsavedBar
        v-if="!isLoading && isDirty && canEdit"
        :saving="isSaving"
        :save-disabled="isCapInvalid || isCostCapInvalid"
        @discard="handleDiscard"
        @save="handleSave"
      />
    </Transition>
  </div>
  <SettingsRestricted v-else />
</template>
