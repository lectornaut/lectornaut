<script lang="ts" setup>
import type {
  BillingCatalog,
  BillingInterval,
  BillingPlanKey,
} from "@/composables/useFunctions"

interface Props {
  selectedPlanKey: BillingPlanKey | null
  selectedInterval: BillingInterval | null
  hasActivePlan: boolean
  activePlanKey: BillingPlanKey | null
  activeInterval: BillingInterval | null
  billingStatus: string | null
  canManageBilling: boolean
  isPricingLoading: boolean
  billingCatalog: BillingCatalog | null
  seatCount: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  "update:selectedPlanKey": [value: BillingPlanKey | null]
  "update:selectedInterval": [value: BillingInterval | null]
}>()

const { t } = useI18n()

const planOptions: Array<{
  id: BillingPlanKey
  titleKey: string
  descriptionKey: string
}> = [
  {
    id: "personal",
    titleKey: "settings.plans.subscriptionPlan.personal.title",
    descriptionKey: "settings.plans.subscriptionPlan.personal.description",
  },
  {
    id: "professional",
    titleKey: "settings.plans.subscriptionPlan.professional.title",
    descriptionKey: "settings.plans.subscriptionPlan.professional.description",
  },
  {
    id: "business",
    titleKey: "settings.plans.subscriptionPlan.business.title",
    descriptionKey: "settings.plans.subscriptionPlan.business.description",
  },
  {
    id: "enterprise",
    titleKey: "settings.plans.subscriptionPlan.enterprise.title",
    descriptionKey: "settings.plans.subscriptionPlan.enterprise.description",
  },
]

const selectedPlanKeyModel = computed({
  get: () => props.selectedPlanKey,
  set: (value: BillingPlanKey | null) => emit("update:selectedPlanKey", value),
})

const selectedIntervalModel = computed({
  get: () => props.selectedInterval,
  set: (value: BillingInterval | null) =>
    emit("update:selectedInterval", value),
})

const activePlanLabel = computed(() => {
  if (!props.activePlanKey) return t("pages.welcome.plans.noActivePlan")
  return `${props.activePlanKey[0].toUpperCase()}${props.activePlanKey.slice(1)}`
})

const activeIntervalLabel = computed(() => {
  if (props.activeInterval === "year") return t("pages.welcome.plans.annual")
  if (props.activeInterval === "month") return t("pages.welcome.plans.monthly")
  return t("pages.welcome.plans.notAvailable")
})

const statusLabel = computed(
  () => props.billingStatus ?? t("pages.welcome.plans.notAvailable")
)

const disableInputs = computed(
  () => props.hasActivePlan || !props.canManageBilling
)

const normalizedSeatCount = computed(() => Math.max(1, props.seatCount || 1))
const seatCountLabel = computed(() =>
  t("pages.welcome.plans.seatCount", { count: normalizedSeatCount.value })
)

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

const getPriceLabel = (planKey: BillingPlanKey, interval: BillingInterval) => {
  const price = props.billingCatalog?.[planKey]?.[interval]
  if (!price?.currency || typeof price.unitAmount !== "number") {
    return props.isPricingLoading
      ? t("states.loading")
      : t("pages.welcome.plans.unavailable")
  }

  return formatCurrencyAmount(price.unitAmount, price.currency)
}

const getTotalPriceLabel = (
  planKey: BillingPlanKey,
  interval: BillingInterval
) => {
  const price = props.billingCatalog?.[planKey]?.[interval]
  if (!price?.currency || typeof price.unitAmount !== "number") {
    return props.isPricingLoading
      ? t("states.loading")
      : t("pages.welcome.plans.unavailable")
  }

  return formatCurrencyAmount(
    price.unitAmount * normalizedSeatCount.value,
    price.currency
  )
}
</script>

<template>
  <div class="p-4">
    <FieldGroup>
      <FieldSet>
        <Field orientation="vertical">
          <FieldContent>
            <FieldLabel>{{ t("pages.welcome.content.plans") }}</FieldLabel>
            <FieldDescription>
              {{ t("pages.welcome.content.plansDescription") }}
            </FieldDescription>
          </FieldContent>
          <FieldDescription
            v-if="hasActivePlan"
            class="text-muted-foreground rounded-md border px-3 py-2 text-sm"
          >
            {{
              t("pages.welcome.plans.activeSummary", {
                plan: activePlanLabel,
                interval: activeIntervalLabel,
                status: statusLabel,
              })
            }}
            <br />
            {{ t("pages.welcome.plans.activeReadOnly") }}
            <br />
            {{
              t("pages.welcome.plans.quantitySummary", {
                seats: seatCountLabel,
              })
            }}
          </FieldDescription>
          <FieldDescription
            v-else-if="!canManageBilling"
            class="text-muted-foreground rounded-md border px-3 py-2 text-sm"
          >
            {{ t("pages.welcome.plans.noPermission") }}
          </FieldDescription>
        </Field>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <Field orientation="vertical">
          <FieldContent>
            <FieldLabel for="onboarding-plan-key">
              {{ t("settings.plans.subscriptionPlan.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.plans.subscriptionPlan.description") }}
            </FieldDescription>
          </FieldContent>
          <RadioGroup
            :model-value="selectedPlanKeyModel"
            :disabled="disableInputs"
            class="grid grid-cols-1 gap-2"
            @update:model-value="
              (value) => (selectedPlanKeyModel = value as BillingPlanKey | null)
            "
          >
            <Field
              v-for="plan in planOptions"
              :key="plan.id"
              orientation="horizontal"
              class="items-start gap-3 rounded-md border px-3 py-2"
            >
              <RadioGroupItem
                :id="`onboarding-plan-${plan.id}`"
                :value="plan.id"
              />
              <FieldContent class="gap-0.5">
                <FieldLabel :for="`onboarding-plan-${plan.id}`">
                  {{ t(plan.titleKey) }}
                </FieldLabel>
                <FieldDescription>
                  {{ t(plan.descriptionKey) }}
                </FieldDescription>
                <FieldDescription>
                  {{
                    t("pages.welcome.plans.pricingSummaryPerSeat", {
                      monthly: getPriceLabel(plan.id, "month"),
                      annual: getPriceLabel(plan.id, "year"),
                    })
                  }}
                </FieldDescription>
                <FieldDescription>
                  {{
                    t("pages.welcome.plans.pricingSummaryTotal", {
                      monthly: getTotalPriceLabel(plan.id, "month"),
                      annual: getTotalPriceLabel(plan.id, "year"),
                      seats: seatCountLabel,
                    })
                  }}
                </FieldDescription>
              </FieldContent>
            </Field>
          </RadioGroup>
        </Field>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <Field orientation="vertical">
          <FieldContent>
            <FieldLabel for="onboarding-plan-interval">
              {{ t("settings.plans.subscriptionTerm.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.plans.subscriptionTerm.description") }}
            </FieldDescription>
          </FieldContent>
          <RadioGroup
            :model-value="selectedIntervalModel"
            :disabled="disableInputs"
            class="grid grid-cols-1 gap-2"
            @update:model-value="
              (value) =>
                (selectedIntervalModel = value as BillingInterval | null)
            "
          >
            <Field
              orientation="horizontal"
              class="items-start gap-3 rounded-md border px-3 py-2"
            >
              <RadioGroupItem
                id="onboarding-plan-interval-month"
                value="month"
              />
              <FieldContent class="gap-0.5">
                <FieldLabel for="onboarding-plan-interval-month">
                  {{ t("settings.plans.subscriptionTerm.monthly") }}
                </FieldLabel>
                <FieldDescription>
                  {{ t("pages.welcome.plans.monthlyDescription") }}
                </FieldDescription>
              </FieldContent>
            </Field>
            <Field
              orientation="horizontal"
              class="items-start gap-3 rounded-md border px-3 py-2"
            >
              <RadioGroupItem id="onboarding-plan-interval-year" value="year" />
              <FieldContent class="gap-0.5">
                <FieldLabel for="onboarding-plan-interval-year">
                  {{ t("settings.plans.subscriptionTerm.annually") }}
                </FieldLabel>
                <FieldDescription>
                  {{ t("pages.welcome.plans.annualDescription") }}
                </FieldDescription>
              </FieldContent>
            </Field>
          </RadioGroup>
        </Field>
      </FieldSet>
    </FieldGroup>
  </div>
</template>
