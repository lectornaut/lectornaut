<script lang="ts" setup>
import {
  changeSubscriptionPlan as changeSubscriptionPlanFn,
  createCheckoutSession as createCheckoutSessionFn,
  type BillingInterval,
  type BillingPlanKey,
} from "@/composables/useFunctions"
import { useTeamActions } from "@/composables/useTeamActions"
import {
  IconBadgeDollarSign,
  IconCheck,
  IconChevronDown,
  IconMinus,
} from "@/data/icons"
import {
  BILLING_PLAN_ORDER,
  countBillableSeatsFromMembers,
  hasActiveLikeBillingStatus,
} from "@/helpers/billing"
import { settingsPlanFeatures, settingsPlans } from "@/helpers/defaults"
import {
  closePendingExternalTab,
  createPendingExternalTab,
  openExternalUrl,
} from "@/helpers/openExternalUrl"
import { useBillingStore } from "@/stores/billingStore"
import { storeToRefs } from "pinia"
import { toast } from "vue-sonner"

const { t } = useI18n()
const { canManageBilling, currentTeam, teamMembers } = useTeamActions()
const billingStore = useBillingStore()
void billingStore.ensureCatalogLoaded()
const {
  catalog: billingCatalog,
  isCatalogLoading: isPricingLoading,
  billing,
  status,
} = storeToRefs(billingStore)
const { refreshBilling } = billingStore

const orderedPlans: readonly BillingPlanKey[] = BILLING_PLAN_ORDER

// Subscription Plans Logic
const billingCycle = ref<"annually" | "monthly" | null>(null)
const activeBillingCycle = ref<"annually" | "monthly">("annually")
const activePlanId = ref<BillingPlanKey | null>(null)
const selectedPlanId = ref<BillingPlanKey | null>(null)

const isSaving = ref(false)
const hasActiveSubscription = computed(() => {
  return hasActiveLikeBillingStatus(status.value)
})

const toInterval = (cycle: "annually" | "monthly"): BillingInterval =>
  cycle === "monthly" ? "month" : "year"

const capitalize = (value: string) =>
  `${value[0].toUpperCase()}${value.slice(1)}`

const getCycleInterval = (cycle: "annually" | "monthly"): BillingInterval =>
  cycle === "annually" ? "year" : "month"

watch(
  [
    () => billing.value?.planKey,
    () => billing.value?.interval,
    hasActiveSubscription,
  ],
  ([planKey, interval, hasActive]) => {
    const nextCycle = interval === "month" ? "monthly" : "annually"
    activeBillingCycle.value = nextCycle

    if (
      hasActive &&
      planKey &&
      orderedPlans.includes(planKey as BillingPlanKey)
    ) {
      const normalizedPlan = planKey as BillingPlanKey
      activePlanId.value = normalizedPlan
      selectedPlanId.value = normalizedPlan
      billingCycle.value = nextCycle
      return
    }

    activePlanId.value = null
    if (!isSaving.value) {
      selectedPlanId.value = null
      billingCycle.value = null
    }
  },
  { immediate: true }
)

const hasPendingChanges = computed(() => {
  if (!canManageBilling.value) return false
  if (!hasActiveSubscription.value)
    return !!selectedPlanId.value && !!billingCycle.value
  if (!activePlanId.value) return !!selectedPlanId.value && !!billingCycle.value

  return (
    selectedPlanId.value !== activePlanId.value ||
    billingCycle.value !== activeBillingCycle.value
  )
})

const currentPlanSummary = computed(() => {
  if (!hasActiveSubscription.value || !activePlanId.value) {
    return "No active subscription. Select a plan and continue to checkout."
  }

  const cycleLabel =
    activeBillingCycle.value === "annually" ? "annual" : "monthly"
  return `Current: ${capitalize(activePlanId.value)} (${cycleLabel}) • Status: ${status.value ?? "active"}`
})

const canSave = computed(() => {
  if (
    !canManageBilling.value ||
    !currentTeam.value?.id ||
    isSaving.value ||
    !selectedPlanId.value ||
    !billingCycle.value
  ) {
    return false
  }
  if (!hasActiveSubscription.value) return true
  return hasPendingChanges.value
})

const seatCount = computed(() => {
  const subscriptionQuantity = billing.value?.quantity
  if (
    typeof subscriptionQuantity === "number" &&
    Number.isFinite(subscriptionQuantity) &&
    subscriptionQuantity > 0
  ) {
    return Math.floor(subscriptionQuantity)
  }
  return countBillableSeatsFromMembers(teamMembers.value)
})

const seatCountLabel = computed(() =>
  t("settings.plans.seatCount", { count: seatCount.value })
)

const saveButtonLabel = computed(() =>
  hasActiveSubscription.value ? "Apply plan change" : "Continue to checkout"
)

const saveChanges = async () => {
  if (
    !canSave.value ||
    !currentTeam.value?.id ||
    !selectedPlanId.value ||
    !billingCycle.value
  )
    return

  isSaving.value = true
  try {
    if (hasActiveSubscription.value) {
      await changeSubscriptionPlanFn({
        teamId: currentTeam.value.id,
        targetPlanKey: selectedPlanId.value,
        targetInterval: toInterval(billingCycle.value),
      })
      await refreshBilling()

      activePlanId.value = selectedPlanId.value
      activeBillingCycle.value = billingCycle.value
      toast.success("Plan updated successfully.")
      discardChanges()
      return
    }

    const pendingTab = createPendingExternalTab()
    try {
      const { data } = await createCheckoutSessionFn({
        teamId: currentTeam.value.id,
        planKey: selectedPlanId.value,
        interval: toInterval(billingCycle.value),
      })
      await openExternalUrl(data.url, pendingTab)
    } catch (error) {
      closePendingExternalTab(pendingTab)
      throw error
    }
  } catch (error) {
    toast.error("Unable to update subscription.", {
      description: error instanceof Error ? error.message : String(error),
    })
  } finally {
    isSaving.value = false
  }
}

const discardChanges = () => {
  if (hasActiveSubscription.value && activePlanId.value) {
    selectedPlanId.value = activePlanId.value
    billingCycle.value = activeBillingCycle.value
    return
  }

  selectedPlanId.value = null
  billingCycle.value = null
}

const selectPlan = (planId: BillingPlanKey) => {
  if (!canManageBilling.value || isSaving.value) return
  selectedPlanId.value = planId
}

const formatCurrencyAmount = (
  amountInMinorUnits: number,
  currency: string
): string => {
  const currencyCode = currency.toUpperCase()
  const amount = amountInMinorUnits / 100
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currencyCode}`
  }
}

const getPlanPricePerMonthLabel = (
  planId: BillingPlanKey,
  cycle: "annually" | "monthly" | null
): string => {
  if (!cycle) return isPricingLoading.value ? "Loading..." : "—"
  const interval = getCycleInterval(cycle)
  const price = billingCatalog.value?.[planId]?.[interval]
  if (!price?.currency || typeof price.unitAmount !== "number") {
    return isPricingLoading.value ? "Loading..." : "Unavailable"
  }

  const normalizedMinorUnits =
    cycle === "annually" ? price.unitAmount / 12 : price.unitAmount
  return formatCurrencyAmount(normalizedMinorUnits, price.currency)
}

const getPlanTotalLabel = (
  planId: BillingPlanKey,
  cycle: "annually" | "monthly" | null
): string => {
  if (!cycle) return isPricingLoading.value ? "Loading..." : "—"
  const interval = getCycleInterval(cycle)
  const price = billingCatalog.value?.[planId]?.[interval]
  if (!price?.currency || typeof price.unitAmount !== "number") {
    return isPricingLoading.value ? "Loading..." : "Unavailable"
  }

  const totalMinorUnits = price.unitAmount * seatCount.value
  return formatCurrencyAmount(totalMinorUnits, price.currency)
}

const getPlanStatus = (planId: BillingPlanKey) => {
  if (!hasActiveSubscription.value || !activePlanId.value) {
    return selectedPlanId.value === planId ? "selected" : "available"
  }

  if (planId === activePlanId.value) {
    return "active"
  }

  if (planId === selectedPlanId.value) {
    return "selected"
  }

  const currentPlan = {
    planKey: activePlanId.value,
    interval: toInterval(activeBillingCycle.value),
  }
  const targetPlan = {
    planKey: planId,
    interval: toInterval(billingCycle.value ?? activeBillingCycle.value),
  }

  const currentPrice =
    billingCatalog.value?.[currentPlan.planKey]?.[currentPlan.interval]
      ?.unitAmount
  const targetPrice =
    billingCatalog.value?.[targetPlan.planKey]?.[targetPlan.interval]
      ?.unitAmount

  if (typeof currentPrice === "number" && typeof targetPrice === "number") {
    if (targetPrice > currentPrice) return "upgrade"
    if (targetPrice < currentPrice) return "downgrade"
  }

  const currentIndex = orderedPlans.indexOf(currentPlan.planKey)
  const planIndex = orderedPlans.indexOf(planId)
  if (planIndex > currentIndex) return "upgrade"
  return "downgrade"
}

const getButtonVariant = (planId: BillingPlanKey) => {
  const status = getPlanStatus(planId)
  if (status === "active") return "secondary"

  const referencePlanId =
    hasActiveSubscription.value && activePlanId.value
      ? activePlanId.value
      : selectedPlanId.value

  if (!referencePlanId) return "outline"

  const referenceIndex = orderedPlans.indexOf(referencePlanId)
  const planIndex = orderedPlans.indexOf(planId)

  if (planIndex === referenceIndex + 1) return "default"
  if (planIndex > referenceIndex) return "outline"
  if (planIndex < referenceIndex) return "ghost"
  return "default"
}

const getButtonLabel = (planId: BillingPlanKey) => {
  const status = getPlanStatus(planId)
  if (status === "active") return "Active"
  if (status === "selected") return "Selected"
  if (!hasActiveSubscription.value) return "Choose"
  if (status === "upgrade") return "Upgrade"
  return "Downgrade"
}
</script>

<template>
  <div class="flex grow flex-col justify-between">
    <div class="p-6">
      <FieldGroup>
        <FieldSet>
          <Field orientation="vertical">
            <FieldContent>
              <FieldLabel for="subscription-plan">
                {{ t("settings.plans.subscriptionPlan.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.plans.subscriptionPlan.description") }}
              </FieldDescription>
              <FieldDescription>
                {{ currentPlanSummary }}
              </FieldDescription>
            </FieldContent>
            <div
              v-if="!hasActiveSubscription && !selectedPlanId"
              class="border p-1"
            >
              <Item variant="outline" class="bg-secondary">
                <ItemMedia variant="icon">
                  <IconBadgeDollarSign />
                </ItemMedia>
                <ItemContent class="gap-0.5 truncate">
                  <ItemTitle class="truncate"> No active plan </ItemTitle>
                  <ItemDescription class="truncate text-xs">
                    Select a plan below to get started.
                  </ItemDescription>
                </ItemContent>
              </Item>
            </div>
            <RadioGroup
              :model-value="selectedPlanId"
              class="grid grid-cols-4 gap-2"
              :disabled="!canManageBilling"
              @update:model-value="
                (val) => val && (selectedPlanId = val as BillingPlanKey)
              "
            >
              <FieldLabel
                v-for="plan in settingsPlans"
                :key="plan.id"
                :for="plan.id"
              >
                <Field class="grow">
                  <FieldContent>
                    <FieldTitle>
                      <RadioGroupItem
                        :id="plan.id"
                        :value="plan.id"
                        class="sr-only"
                      />
                      {{ t(plan.titleKey) }}
                    </FieldTitle>
                    <FieldDescription>
                      {{ t(plan.descriptionKey) }}
                    </FieldDescription>
                  </FieldContent>
                  <ul
                    class="marker:text-accent flex h-full list-inside list-disc flex-col space-y-2 text-xs"
                  >
                    <li v-for="highlight in plan.highlights" :key="highlight">
                      {{ highlight }}
                    </li>
                  </ul>
                  <FieldDescription>
                    {{
                      t("settings.plans.perSeatMonthly", {
                        price: getPlanPricePerMonthLabel(plan.id, billingCycle),
                      })
                    }}
                    <br />
                    {{
                      t("settings.plans.totalForSeats", {
                        total: getPlanTotalLabel(plan.id, billingCycle),
                        seats: seatCountLabel,
                      })
                    }}
                    <template v-if="billingCycle">
                      <br />
                      Billed {{ billingCycle }}
                    </template>
                  </FieldDescription>
                </Field>
              </FieldLabel>
            </RadioGroup>
            <Collapsible>
              <div class="grid gap-3">
                <CollapsibleTrigger as-child>
                  <div class="group bg-secondary relativepy-4">
                    <Badge
                      variant="secondary"
                      class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                    >
                      Compare plans
                      <IconChevronDown
                        class="transition-transform group-data-[state=open]:rotate-180"
                      />
                    </Badge>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent class="border p-1.5">
                  <div class="overflow-clip rounded-xl border">
                    <Table class="bg-secondary overflow-clip">
                      <TableHeader class="bg-secondary">
                        <TableRow class="hover:bg-transparent">
                          <TableHead class="w-1/5 p-2">
                            <span class="font-medium">
                              {{ t("settings.plans.features") }}
                            </span>
                          </TableHead>
                          <TableHead
                            v-for="plan in settingsPlans"
                            :key="plan.id"
                            class="w-1/5 p-2"
                            :class="{
                              'bg-background after:border-primary relative z-10 after:absolute after:inset-0 after:z-10 after:border-x after:border-t':
                                selectedPlanId === plan.id,
                            }"
                          >
                            <span class="font-semibold">
                              {{ t(plan.titleKey) }}
                            </span>
                            <br />
                            <span>
                              {{
                                getPlanPricePerMonthLabel(
                                  plan.id,
                                  billingCycle
                                )
                              }}/seat/mo
                              <br />
                              {{
                                t("settings.plans.totalForSeats", {
                                  total: getPlanTotalLabel(
                                    plan.id,
                                    billingCycle
                                  ),
                                  seats: seatCountLabel,
                                })
                              }}
                              <template v-if="billingCycle">
                                <br />
                                Billed {{ billingCycle }}
                              </template>
                            </span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody class="bg-background">
                        <TableRow
                          v-for="feature in settingsPlanFeatures"
                          :key="feature.name"
                        >
                          <TableCell class="p-2 font-medium">
                            {{ feature.name }}
                          </TableCell>
                          <TableCell
                            v-for="plan in settingsPlans"
                            :key="plan.id"
                            :class="{
                              'bg-background after:border-primary relative z-10 p-2 after:absolute after:inset-x-0 after:-inset-y-px after:z-10 after:border-x':
                                selectedPlanId === plan.id,
                            }"
                          >
                            <template
                              v-if="
                                typeof (feature.values as any)[plan.id] ===
                                'boolean'
                              "
                            >
                              <IconCheck
                                v-if="
                                  (feature.values as Record<string, boolean>)[
                                    plan.id
                                  ]
                                "
                              />
                              <IconMinus v-else />
                            </template>
                            <template v-else>
                              {{ (feature.values as any)[plan.id] }}
                            </template>
                          </TableCell>
                        </TableRow>
                      </TableBody>
                      <TableFooter class="bg-secondary">
                        <TableRow class="bg-secondary hover:bg-transparent">
                          <TableCell class="p-2">
                            <div class="flex items-center gap-2">
                              <Switch
                                id="annual-mode-table"
                                :model-value="billingCycle === 'annually'"
                                @update:model-value="
                                  (val) =>
                                    (billingCycle = val
                                      ? 'annually'
                                      : 'monthly')
                                "
                              />
                              <Label for="annual-mode-table">
                                Annual billing
                              </Label>
                            </div>
                          </TableCell>
                          <TableCell
                            v-for="plan in settingsPlans"
                            :key="plan.id"
                            :class="{
                              'bg-background after:border-primary after: relative z-10 p-2 after:absolute after:inset-0 after:z-10 after:border-x after:border-b':
                                selectedPlanId === plan.id,
                            }"
                          >
                            <Button
                              class="w-full shadow-none"
                              :variant="getButtonVariant(plan.id)"
                              :disabled="
                                !canManageBilling ||
                                isSaving ||
                                selectedPlanId === plan.id
                              "
                              @click="selectPlan(plan.id)"
                            >
                              <Spinner
                                v-if="isSaving && selectedPlanId === plan.id"
                              />
                              <template v-else>
                                {{ getButtonLabel(plan.id) }}
                              </template>
                            </Button>
                          </TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          </Field>
        </FieldSet>
        <FieldSeparator />
        <FieldSet>
          <Field orientation="vertical">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.plans.subscriptionTerm.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.plans.subscriptionTerm.description") }}
              </FieldDescription>
            </FieldContent>
            <RadioGroup
              :model-value="billingCycle"
              @update:model-value="
                (val) => (billingCycle = val as 'annually' | 'monthly')
              "
            >
              <Field orientation="horizontal">
                <RadioGroupItem id="plan-annually" value="annually" />
                <FieldLabel for="plan-annually">
                  {{ t("settings.plans.subscriptionTerm.annually") }}
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem id="plan-monthly" value="monthly" />
                <FieldLabel for="plan-monthly">
                  {{ t("settings.plans.subscriptionTerm.monthly") }}
                </FieldLabel>
              </Field>
            </RadioGroup>
          </Field>
        </FieldSet>
      </FieldGroup>
    </div>

    <DialogFooter
      v-if="canManageBilling && hasPendingChanges"
      class="bg-background/50 sticky bottom-3 z-10 m-3 flex items-center gap-2 border p-2 backdrop-blur-lg"
    >
      <p class="text-muted-foreground mr-auto ml-2 text-xs">
        {{ t("settings.unsavedChanges") }}
      </p>
      <Button variant="secondary" :disabled="isSaving" @click="discardChanges">
        {{ t("common.discard") }}
      </Button>
      <Button
        :disabled="!canSave || isSaving"
        class="relative"
        @click="saveChanges"
      >
        <Spinner v-if="isSaving" />
        {{ saveButtonLabel }}
      </Button>
    </DialogFooter>
  </div>
</template>
