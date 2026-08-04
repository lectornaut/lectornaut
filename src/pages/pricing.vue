<script lang="ts" setup>
import {
  changeSubscriptionPlan as changeSubscriptionPlanFn,
  createCheckoutSession as createCheckoutSessionFn,
  type BillingInterval,
  type BillingPlanKey,
} from "@/composables/useFunctions"
import { useTeamActions } from "@/composables/useTeamActions"
import { IconCircleCheck } from "@/data/icons"
import { hasActiveLikeBillingStatus } from "@/helpers/billing"
import {
  closePendingExternalTab,
  createPendingExternalTab,
  openExternalUrl,
} from "@/helpers/openExternalUrl"
import { useBillingStore } from "@/stores/billingStore"
import { storeToRefs } from "pinia"
import { toast } from "vue-sonner"
import { useCurrentUser } from "vuefire"

definePage({
  meta: {
    layout: "landing",
  },
})

useHead({
  title: "Pricing",
})

const { t } = useI18n()
const router = useRouter()
const user = useCurrentUser()
const { canManageBilling, currentTeam } = useTeamActions()
const billingStore = useBillingStore()
void billingStore.ensureCatalogLoaded()
const {
  catalog: billingCatalog,
  isCatalogLoading: isPricingLoading,
  planKey: activePlanKey,
  interval: activeInterval,
  status,
} = storeToRefs(billingStore)
const { refreshBilling } = billingStore
const actionLoadingPlanId = ref<BillingPlanKey | null>(null)
type BillingDuration = "monthly" | "annual"

const billingDuration = computed(() => [
  {
    title: t("pages.pricing.billing.monthly"),
    value: "monthly" as const,
  },
  {
    title: t("pages.pricing.billing.annual"),
    value: "annual" as const,
  },
])

const activeBillingDuration = ref<BillingDuration>("monthly")

const selectedInterval = computed<BillingInterval>(() =>
  activeBillingDuration.value === "monthly" ? "month" : "year"
)

const hasActiveSubscription = computed(() => {
  return hasActiveLikeBillingStatus(status.value)
})

const canManageCurrentTeamBilling = computed(
  () => !!user.value && !!currentTeam.value?.id && canManageBilling.value
)

const isCurrentSelection = (planId: BillingPlanKey): boolean => {
  return (
    hasActiveSubscription.value &&
    activePlanKey.value === planId &&
    activeInterval.value === selectedInterval.value
  )
}

const getActionLabel = (planId: BillingPlanKey): string => {
  if (!user.value) return t("pages.pricing.plans.cta.getStarted")
  if (!canManageCurrentTeamBilling.value)
    return t("settings.billing.noPermission")
  if (isCurrentSelection(planId)) return t("settings.billing.currentPlan.label")
  if (hasActiveSubscription.value)
    return t("settings.billing.changePlan.button")
  return t("settings.billing.currentPlan.subscribeButton")
}

const isActionDisabled = (planId: BillingPlanKey): boolean => {
  if (actionLoadingPlanId.value !== null) return true
  if (!user.value) return false
  if (!canManageCurrentTeamBilling.value) return true
  return isCurrentSelection(planId)
}

const handlePlanAction = async (planId: BillingPlanKey): Promise<void> => {
  if (!user.value) {
    await router.push("/enter")
    return
  }

  if (!currentTeam.value?.id) {
    toast.error(t("pages.pricing.errors.selectTeam"))
    return
  }

  if (!canManageBilling.value) {
    toast.error(t("pages.pricing.errors.noPermission"))
    return
  }

  if (isCurrentSelection(planId)) return

  actionLoadingPlanId.value = planId

  try {
    if (hasActiveSubscription.value) {
      await changeSubscriptionPlanFn({
        teamId: currentTeam.value.id,
        targetPlanKey: planId,
        targetInterval: selectedInterval.value,
      })
      await refreshBilling()
      toast.success(t("pages.pricing.toasts.planUpdated"))
      return
    }

    const pendingTab = createPendingExternalTab()
    try {
      const { data } = await createCheckoutSessionFn({
        teamId: currentTeam.value.id,
        planKey: planId,
        interval: selectedInterval.value,
      })

      await openExternalUrl(data.url, pendingTab)
    } catch (error) {
      closePendingExternalTab(pendingTab)
      throw error
    }
  } catch (error) {
    toast.error("Unable to continue with billing.", {
      description: error instanceof Error ? error.message : String(error),
    })
  } finally {
    actionLoadingPlanId.value = null
  }
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

const getDisplayedPrice = (
  planId: BillingPlanKey,
  interval: BillingInterval
): string => {
  const price = billingCatalog.value?.[planId]?.[interval]
  if (!price?.currency || typeof price.unitAmount !== "number") {
    return isPricingLoading.value
      ? t("states.loading")
      : t("states.unavailable")
  }

  const suffix = interval === "month" ? "/month" : "/year"
  return `${formatCurrencyAmount(price.unitAmount, price.currency)}${suffix}`
}

const pricingPlans = computed(() => [
  {
    title: t("pages.pricing.plans.personal.title"),
    id: "personal" as BillingPlanKey,
    monthlyPrice: getDisplayedPrice("personal", "month"),
    annualPrice: getDisplayedPrice("personal", "year"),
    overview: [
      t("pages.pricing.features.unlimitedConnections"),
      t("pages.pricing.features.professionalFeatures"),
      t("pages.pricing.features.communitySupport"),
    ],
  },
  {
    title: t("pages.pricing.plans.professional.title"),
    id: "professional" as BillingPlanKey,
    monthlyPrice: getDisplayedPrice("professional", "month"),
    annualPrice: getDisplayedPrice("professional", "year"),
    overview: [
      t("pages.pricing.features.everythingInPersonal"),
      t("pages.pricing.features.advancedFeatures"),
      t("pages.pricing.features.prioritySupport"),
    ],
  },
  {
    title: t("pages.pricing.plans.business.title"),
    id: "business" as BillingPlanKey,
    monthlyPrice: getDisplayedPrice("business", "month"),
    annualPrice: getDisplayedPrice("business", "year"),
    overview: [
      t("pages.pricing.features.everythingInProfessional"),
      t("pages.pricing.features.teamManagement"),
      t("pages.pricing.features.enhancedSecurity"),
      t("pages.pricing.features.customizableWorkflows"),
      t("pages.pricing.features.analyticsAndReporting"),
      t("pages.pricing.features.dedicatedSupport"),
    ],
  },
  {
    title: t("pages.pricing.plans.enterprise.title"),
    id: "enterprise" as BillingPlanKey,
    monthlyPrice: getDisplayedPrice("enterprise", "month"),
    annualPrice: getDisplayedPrice("enterprise", "year"),
    overview: [
      t("pages.pricing.features.everythingInBusiness"),
      t("pages.pricing.features.customSLAs"),
      t("pages.pricing.features.dedicatedAccountManager"),
      t("pages.pricing.features.integrationSupport"),
      t("pages.pricing.features.complianceAndAudits"),
    ],
  },
])

const comparisonPlans = computed(() => [
  {
    feature: t("pages.pricing.comparison.features.agents"),
    personal: t("pages.pricing.comparison.agents.5"),
    professional: t("pages.pricing.comparison.agents.10"),
    business: t("pages.pricing.comparison.agents.unlimited"),
    enterprise: t("pages.pricing.comparison.agents.unlimited"),
  },
  {
    feature: t("pages.pricing.comparison.features.members"),
    personal: t("pages.pricing.comparison.members.1"),
    professional: t("pages.pricing.comparison.members.1"),
    business: t("pages.pricing.comparison.members.unlimited"),
    enterprise: t("pages.pricing.comparison.members.unlimited"),
  },
  {
    feature: t("pages.pricing.comparison.features.teams"),
    personal: t("pages.pricing.comparison.teams.2"),
    professional: t("pages.pricing.comparison.teams.5"),
    business: t("pages.pricing.comparison.teams.unlimited"),
    enterprise: t("pages.pricing.comparison.teams.unlimited"),
  },
  {
    feature: t("pages.pricing.comparison.features.storage"),
    personal: t("pages.pricing.comparison.storage.10mb"),
    professional: t("pages.pricing.comparison.storage.100mb"),
    business: t("pages.pricing.comparison.storage.1gb"),
    enterprise: t("pages.pricing.comparison.storage.unlimited"),
  },
  {
    feature: t("pages.pricing.comparison.features.workflows"),
    personal: t("pages.pricing.comparison.runs.10"),
    professional: t("pages.pricing.comparison.runs.100"),
    business: t("pages.pricing.comparison.runs.500"),
    enterprise: t("pages.pricing.comparison.runs.unlimited"),
  },
  {
    feature: t("pages.pricing.comparison.features.authentication"),
    personal: t("pages.pricing.comparison.auth.basic"),
    professional: t("pages.pricing.comparison.auth.mfa"),
    business: t("pages.pricing.comparison.auth.sso"),
    enterprise: t("pages.pricing.comparison.auth.oidc"),
  },
  {
    feature: t("pages.pricing.comparison.features.support"),
    personal: t("pages.pricing.comparison.support.community"),
    professional: t("pages.pricing.comparison.support.email"),
    business: t("pages.pricing.comparison.support.priority"),
    enterprise: t("pages.pricing.comparison.support.dedicated"),
  },
  {
    feature: t("pages.pricing.comparison.features.integrations"),
    personal: t("pages.pricing.comparison.common.no"),
    professional: t("pages.pricing.comparison.common.yes"),
    business: t("pages.pricing.comparison.common.yes"),
    enterprise: t("pages.pricing.comparison.common.yes"),
  },
  {
    feature: t("pages.pricing.comparison.features.apiAccess"),
    personal: t("pages.pricing.comparison.common.no"),
    professional: t("pages.pricing.comparison.common.yes"),
    business: t("pages.pricing.comparison.common.yes"),
    enterprise: t("pages.pricing.comparison.common.yes"),
  },
  {
    feature: t("pages.pricing.comparison.features.accountManager"),
    personal: t("pages.pricing.comparison.common.no"),
    professional: t("pages.pricing.comparison.common.no"),
    business: t("pages.pricing.comparison.common.yes"),
    enterprise: t("pages.pricing.comparison.common.yes"),
  },
  {
    feature: t("pages.pricing.comparison.features.analytics"),
    personal: t("pages.pricing.comparison.common.no"),
    professional: t("pages.pricing.comparison.common.no"),
    business: t("pages.pricing.comparison.common.yes"),
    enterprise: t("pages.pricing.comparison.common.yes"),
  },
  {
    feature: t("pages.pricing.comparison.features.auditLog"),
    personal: t("pages.pricing.comparison.common.no"),
    professional: t("pages.pricing.comparison.common.no"),
    business: t("pages.pricing.comparison.common.no"),
    enterprise: t("pages.pricing.comparison.common.yes"),
  },
  {
    feature: t("pages.pricing.comparison.features.scim"),
    personal: t("pages.pricing.comparison.common.no"),
    professional: t("pages.pricing.comparison.common.no"),
    business: t("pages.pricing.comparison.common.no"),
    enterprise: t("pages.pricing.comparison.common.yes"),
  },
  {
    feature: t("pages.pricing.comparison.features.compliance"),
    personal: t("pages.pricing.comparison.common.no"),
    professional: t("pages.pricing.comparison.common.no"),
    business: t("pages.pricing.comparison.common.no"),
    enterprise: t("pages.pricing.comparison.common.yes"),
  },
  {
    feature: t("pages.pricing.comparison.features.uptime"),
    personal: t("pages.pricing.comparison.common.no"),
    professional: t("pages.pricing.comparison.common.no"),
    business: t("pages.pricing.comparison.common.no"),
    enterprise: t("pages.pricing.comparison.common.yes"),
  },
])
</script>

<template>
  <div class="mx-auto my-32 grid max-w-6xl gap-10">
    <div class="space-y-6 text-center">
      <h2 class="font-display text-6xl font-bold">
        {{ t("pages.pricing.title") }}
      </h2>
      <p class="text-secondary-foreground">
        {{ t("pages.pricing.subtitle") }}
      </p>
    </div>
    <div class="px-8 py-4">
      <Tabs v-model="activeBillingDuration" class="grid w-full gap-10">
        <TabsList class="bg-input/50 mx-auto h-9! p-0">
          <TabsTrigger
            v-for="item in billingDuration"
            :key="item.value"
            :value="item.value"
            class="data-[state=active]:border-border! data-[state=active]:bg-background h-9"
          >
            {{ item.title }}
          </TabsTrigger>
        </TabsList>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          <Card v-for="card in pricingPlans" :key="card.id">
            <CardHeader>
              <CardTitle
                class="text-2xl leading-tight font-semibold tracking-tight"
              >
                {{ card.title }}
              </CardTitle>
              <CardDescription>
                {{
                  activeBillingDuration === "monthly"
                    ? card.monthlyPrice
                    : card.annualPrice
                }}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul class="flex flex-col gap-5">
                <li
                  v-for="feature in card.overview"
                  :key="feature"
                  class="flex items-start gap-3"
                >
                  <IconCircleCheck />
                  <p class="leading-loose first-line:leading-none">
                    {{ feature }}
                  </p>
                </li>
              </ul>
            </CardContent>
            <CardFooter class="mt-auto grid">
              <Button
                :disabled="isActionDisabled(card.id)"
                @click="handlePlanAction(card.id)"
              >
                <Spinner v-if="actionLoadingPlanId === card.id" />
                {{ getActionLabel(card.id) }}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </Tabs>
    </div>
    <div class="px-8 py-4">
      <div class="overflow-x-auto">
        <Table class="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead> {{ t("pages.pricing.feature") }} </TableHead>
              <TableHead
                v-for="plan in pricingPlans"
                :key="plan.id"
                class="text-lg font-semibold tracking-tight"
              >
                {{ plan.title }}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="plan in comparisonPlans" :key="plan.feature">
              <TableCell>
                {{ plan.feature }}
              </TableCell>
              <TableCell>
                {{ plan.personal }}
              </TableCell>
              <TableCell>
                {{ plan.professional }}
              </TableCell>
              <TableCell>
                {{ plan.business }}
              </TableCell>
              <TableCell>
                {{ plan.enterprise }}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  </div>
</template>
