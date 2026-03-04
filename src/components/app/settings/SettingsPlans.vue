<script lang="ts" setup>
import { useBillingAccess } from "@/composables/useBillingAccess"
import {
  changeSubscriptionPlan as changeSubscriptionPlanFn,
  createCheckoutSession as createCheckoutSessionFn,
  type BillingInterval,
  type BillingPlanKey,
} from "@/composables/useFunctions"
import { useTeamActions } from "@/composables/useTeamActions"
import { IconCheck, IconChevronDown, IconMinus } from "@/data/icons"
import {
  BILLING_PLAN_ORDER,
  hasActiveLikeBillingStatus,
} from "@/helpers/billing"
import {
  closePendingExternalTab,
  createPendingExternalTab,
  openExternalUrl,
} from "@/helpers/openExternalUrl"
import { toast } from "vue-sonner"

const { t } = useI18n()
const { canManageBilling, currentTeam } = useTeamActions()
const {
  catalog: billingCatalog,
  isCatalogLoading: isPricingLoading,
  billing,
  status,
  refreshBilling,
} = useBillingAccess({ loadCatalog: true })

const orderedPlans: readonly BillingPlanKey[] = BILLING_PLAN_ORDER

// Subscription Plans Logic
const billingCycle = ref<"annually" | "monthly">("annually")
const activeBillingCycle = ref<"annually" | "monthly">("annually")
const activePlanId = ref<BillingPlanKey | null>(null)
const selectedPlanId = ref<BillingPlanKey>("personal")

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
      selectedPlanId.value = "personal"
      billingCycle.value = "annually"
    }
  },
  { immediate: true }
)

const hasPendingChanges = computed(() => {
  if (!canManageBilling.value) return false
  if (!hasActiveSubscription.value) return true
  if (!activePlanId.value) return true

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
  if (!canManageBilling.value || !currentTeam.value?.id || isSaving.value) {
    return false
  }
  if (!hasActiveSubscription.value) return true
  return hasPendingChanges.value
})

const saveButtonLabel = computed(() =>
  hasActiveSubscription.value ? "Apply plan change" : "Continue to checkout"
)

const saveChanges = async () => {
  if (!canSave.value || !currentTeam.value?.id) return

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

  selectedPlanId.value = "personal"
  billingCycle.value = "annually"
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
  cycle: "annually" | "monthly"
): string => {
  const interval = getCycleInterval(cycle)
  const price = billingCatalog.value?.[planId]?.[interval]
  if (!price?.currency || typeof price.unitAmount !== "number") {
    return isPricingLoading.value ? "Loading..." : "Unavailable"
  }

  const normalizedMinorUnits =
    cycle === "annually" ? price.unitAmount / 12 : price.unitAmount
  return formatCurrencyAmount(normalizedMinorUnits, price.currency)
}

const availablePlans = computed(() => [
  {
    id: "personal" as BillingPlanKey,
    titleKey: "settings.plans.subscriptionPlan.personal.title",
    descriptionKey: "settings.plans.subscriptionPlan.personal.description",
    highlights: ["Personal Workspaces", "10 Agents", "100 Monthly Tasks"],
  },
  {
    id: "professional" as BillingPlanKey,
    titleKey: "settings.plans.subscriptionPlan.professional.title",
    descriptionKey: "settings.plans.subscriptionPlan.professional.description",
    highlights: ["Team Workspaces", "100 Agents", "1000 Monthly Tasks"],
  },
  {
    id: "business" as BillingPlanKey,
    titleKey: "settings.plans.subscriptionPlan.business.title",
    descriptionKey: "settings.plans.subscriptionPlan.business.description",
    highlights: ["Team Workspaces", "500 Agents", "5000 Monthly Tasks"],
  },
  {
    id: "enterprise" as BillingPlanKey,
    titleKey: "settings.plans.subscriptionPlan.enterprise.title",
    descriptionKey: "settings.plans.subscriptionPlan.enterprise.description",
    highlights: ["Team Workspaces", "1000 Agents", "10000 Monthly Tasks"],
  },
])

const planFeatures = [
  {
    name: "Workspaces",
    values: {
      personal: "1",
      professional: "5",
      business: "20",
      enterprise: "Unlimited",
    },
  },
  {
    name: "Storage",
    values: {
      personal: "5 GB",
      professional: "50 GB",
      business: "200 GB",
      enterprise: "1 TB",
    },
  },
  {
    name: "Support",
    values: {
      personal: false,
      professional: true,
      business: true,
      enterprise: true,
    },
  },
  {
    name: "Custom Domain",
    values: {
      personal: false,
      professional: false,
      business: true,
      enterprise: true,
    },
  },
  {
    name: "Team Members",
    values: {
      personal: false,
      professional: false,
      business: true,
      enterprise: true,
    },
  },
  {
    name: "Advanced Analytics",
    values: {
      personal: false,
      professional: false,
      business: true,
      enterprise: true,
    },
  },
  {
    name: "Priority Support",
    values: {
      personal: false,
      professional: false,
      business: false,
      enterprise: true,
    },
  },
  {
    name: "Account Manager",
    values: {
      personal: false,
      professional: false,
      business: false,
      enterprise: true,
    },
  },
  {
    name: "Custom SLAs",
    values: {
      personal: false,
      professional: false,
      business: false,
      enterprise: true,
    },
  },
  {
    name: "Onboarding Assistance",
    values: {
      personal: false,
      professional: false,
      business: false,
      enterprise: true,
    },
  },
]

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
    interval: toInterval(billingCycle.value),
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
  <div class="flex flex-1 flex-col justify-between">
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
              <FieldDescription class="text-xs">
                {{ currentPlanSummary }}
              </FieldDescription>
            </FieldContent>
            <RadioGroup
              :model-value="selectedPlanId"
              class="grid grid-cols-4 gap-2"
              :disabled="!canManageBilling"
              @update:model-value="
                (val) => val && (selectedPlanId = val as BillingPlanKey)
              "
            >
              <FieldLabel
                v-for="plan in availablePlans"
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
                  <FieldDescription class="text-xs">
                    {{ getPlanPricePerMonthLabel(plan.id, billingCycle) }} per
                    user per month <br />
                    Billed {{ billingCycle }}
                  </FieldDescription>
                </Field>
              </FieldLabel>
            </RadioGroup>
            <Collapsible>
              <div class="grid gap-3">
                <CollapsibleTrigger as-child>
                  <div class="group bg-secondary relative rounded py-4">
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
                <CollapsibleContent class="rounded-lg border p-1.5">
                  <div class="overflow-clip rounded border">
                    <Table class="bg-secondary overflow-hidden">
                      <TableHeader class="bg-secondary">
                        <TableRow class="hover:bg-transparent">
                          <TableHead class="w-1/5 p-2">
                            <span class="font-medium">
                              {{ t("settings.plans.features") }}
                            </span>
                          </TableHead>
                          <TableHead
                            v-for="plan in availablePlans"
                            :key="plan.id"
                            class="w-1/5 p-2"
                            :class="{
                              'bg-background after:border-primary relative z-10 rounded-t-lg after:absolute after:inset-0 after:z-10 after:rounded-t-lg after:border-x after:border-t':
                                selectedPlanId === plan.id,
                            }"
                          >
                            <span class="font-semibold">
                              {{ t(plan.titleKey) }}
                            </span>
                            <br />
                            <span class="text-muted-foreground text-xs">
                              {{
                                getPlanPricePerMonthLabel(
                                  plan.id,
                                  billingCycle
                                )
                              }}/user/mo
                              <br />
                              Billed {{ billingCycle }}
                            </span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody class="bg-background">
                        <TableRow
                          v-for="feature in planFeatures"
                          :key="feature.name"
                        >
                          <TableCell class="p-2 font-medium">
                            {{ feature.name }}
                          </TableCell>
                          <TableCell
                            v-for="plan in availablePlans"
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
                              <Label
                                for="annual-mode-table"
                                class="text-muted-foreground text-xs"
                              >
                                Annual billing
                              </Label>
                            </div>
                          </TableCell>
                          <TableCell
                            v-for="plan in availablePlans"
                            :key="plan.id"
                            :class="{
                              'bg-background after:border-primary relative z-10 rounded-b-lg p-2 after:absolute after:inset-0 after:z-10 after:rounded-b-lg after:border-x after:border-b':
                                selectedPlanId === plan.id,
                            }"
                          >
                            <Button
                              size="sm"
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
      class="bg-background/50 sticky bottom-3 z-10 m-3 flex items-center gap-2 rounded-md border p-2 backdrop-blur-lg"
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
        <span v-if="isSaving" class="absolute inset-0 grid place-items-center">
          <Spinner />
        </span>
        {{ saveButtonLabel }}
      </Button>
    </DialogFooter>
  </div>
</template>
