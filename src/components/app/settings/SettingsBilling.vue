<script lang="ts" setup>
import { useBillingAccess } from "@/composables/useBillingAccess"
import {
  cancelSubscription as cancelSubscriptionFn,
  createBillingPortalSession as createBillingPortalSessionFn,
  restoreSubscription as restoreSubscriptionFn,
} from "@/composables/useFunctions"
import { useTeamActions } from "@/composables/useTeamActions"
import { IconBadgeDollarSign } from "@/data/icons"
import {
  countBillableSeatsFromMembers,
  hasActiveLikeBillingStatus,
} from "@/helpers/billing"
import { settingsPlans } from "@/helpers/defaults"
import {
  closePendingExternalTab,
  createPendingExternalTab,
  openExternalUrl,
} from "@/helpers/openExternalUrl"
import { emitter } from "@/modules/mitt"
import { toast } from "vue-sonner"

const { t } = useI18n()
const { canManageBilling, currentTeam, teamMembers } = useTeamActions()
const { billing, catalog, isCatalogLoading, status, refreshBilling } =
  useBillingAccess({ loadCatalog: true })

const billingAction = ref<"portal" | "cancel" | "restore" | null>(null)

const hasActiveSubscription = computed(() => {
  return hasActiveLikeBillingStatus(status.value)
})

const currentPlanMeta = computed(() => {
  const planKey = billing.value?.planKey
  if (!planKey) return null
  return settingsPlans.find((plan) => plan.id === planKey) ?? null
})

const planLabel = computed(() => {
  if (!currentPlanMeta.value) return "No active subscription"
  return t(currentPlanMeta.value.titleKey)
})

const hasCurrentPlan = computed(() => !!billing.value?.planKey)

const currentPlanButtonLabel = computed(() => {
  if (!hasCurrentPlan.value) {
    return t("settings.billing.currentPlan.subscribeButton")
  }
  return t("settings.billing.currentPlan.button")
})

const currentPlanDescriptionLabel = computed(() => {
  if (!hasCurrentPlan.value) {
    return t("settings.billing.currentPlan.noPlanDescription")
  }
  return t("settings.billing.currentPlan.description")
})

const intervalLabel = computed(() => {
  if (billing.value?.interval === "month") return "Monthly"
  if (billing.value?.interval === "year") return "Annual"
  return "N/A"
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
  t("settings.billing.seatCount", { count: seatCount.value })
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

const currentPlanUnitPriceLabel = computed(() => {
  const planKey = billing.value?.planKey
  const interval = billing.value?.interval
  if (!planKey || !interval) return "N/A"

  const price = catalog.value?.[planKey]?.[interval]
  if (!price?.currency || typeof price.unitAmount !== "number") {
    return isCatalogLoading.value ? "Loading..." : "Unavailable"
  }

  const intervalSuffix = interval === "year" ? "/year" : "/month"
  return `${formatCurrencyAmount(price.unitAmount, price.currency)}${intervalSuffix}`
})

const currentPlanTotalPriceLabel = computed(() => {
  const planKey = billing.value?.planKey
  const interval = billing.value?.interval
  if (!planKey || !interval) return "N/A"

  const price = catalog.value?.[planKey]?.[interval]
  if (!price?.currency || typeof price.unitAmount !== "number") {
    return isCatalogLoading.value ? "Loading..." : "Unavailable"
  }

  const total = price.unitAmount * seatCount.value
  const intervalSuffix = interval === "year" ? "/year" : "/month"
  return `${formatCurrencyAmount(total, price.currency)}${intervalSuffix}`
})

const currentPeriodEndLabel = computed(() => {
  const currentPeriodEnd = billing.value?.currentPeriodEnd
  if (typeof currentPeriodEnd !== "number") return "N/A"
  return new Date(currentPeriodEnd * 1000).toLocaleDateString()
})

const normalizedBillingStatus = computed(() =>
  (status.value ?? "").toLowerCase()
)
const isCancelled = computed(() => {
  return (
    normalizedBillingStatus.value === "canceled" ||
    normalizedBillingStatus.value === "cancelled"
  )
})
const isCancellationScheduled = computed(() => {
  return !!billing.value?.cancelAtPeriodEnd && !isCancelled.value
})

const billingLifecycleLabel = computed(() => {
  if (isCancelled.value) return "Cancelled"

  if (isCancellationScheduled.value) {
    if (currentPeriodEndLabel.value !== "N/A") {
      return `Scheduled to cancel on ${currentPeriodEndLabel.value}`
    }
    return "Scheduled to cancel at period end"
  }

  if (hasActiveSubscription.value) {
    if (currentPeriodEndLabel.value !== "N/A") {
      return `Renews on ${currentPeriodEndLabel.value}`
    }
    return "Auto-renews each billing cycle"
  }

  return "No active subscription"
})

const canManagePortal = computed(
  () =>
    canManageBilling.value &&
    !!currentTeam.value?.id &&
    hasActiveSubscription.value
)

const canRestorePlan = computed(
  () =>
    canManageBilling.value &&
    !!currentTeam.value?.id &&
    billingAction.value === null &&
    (isCancellationScheduled.value ||
      (isCancelled.value && !hasActiveSubscription.value))
)

const canCancelSubscription = computed(
  () =>
    canManageBilling.value &&
    !!currentTeam.value?.id &&
    hasActiveSubscription.value &&
    !isCancellationScheduled.value &&
    !isCancelled.value &&
    billingAction.value === null
)

const subscriptionActionLabel = computed(() => {
  if (canRestorePlan.value) return "Restore plan"
  if (isCancelled.value) return "Cancelled"
  return "Cancel subscription"
})

const subscriptionActionDescription = computed(() => {
  if (isCancelled.value) {
    if (!hasActiveSubscription.value) {
      return "This subscription is cancelled. Restore plan to resume service."
    }
    return "This subscription has been cancelled."
  }

  if (isCancellationScheduled.value) {
    if (currentPeriodEndLabel.value !== "N/A") {
      return `This subscription is scheduled to cancel on ${currentPeriodEndLabel.value}. Restore plan to continue service.`
    }
    return "This subscription is scheduled to cancel at period end. Restore plan to continue service."
  }

  if (hasActiveSubscription.value) {
    return "Cancel this subscription at the end of the current billing period."
  }

  return "No active subscription to cancel."
})

const openPlansTab = () => {
  emitter.emit("Dialog.Settings.Open", "plans")
}

const openBillingPortal = async (): Promise<void> => {
  if (!currentTeam.value?.id) {
    toast.error("Select a team before opening billing.")
    return
  }

  if (!canManageBilling.value) {
    toast.error("You do not have permission to manage billing for this team.")
    return
  }

  if (!hasActiveSubscription.value) {
    toast.error("No active subscription found for this team.")
    return
  }

  billingAction.value = "portal"
  try {
    const pendingTab = createPendingExternalTab()
    try {
      const { data } = await createBillingPortalSessionFn({
        teamId: currentTeam.value.id,
      })
      await openExternalUrl(data.url, pendingTab)
    } catch (error) {
      closePendingExternalTab(pendingTab)
      throw error
    }
  } catch (error) {
    toast.error("Unable to open billing portal.", {
      description: error instanceof Error ? error.message : String(error),
    })
  } finally {
    billingAction.value = null
  }
}

const cancelTeamSubscription = async (): Promise<void> => {
  if (!currentTeam.value?.id) {
    toast.error("Select a team before cancelling.")
    return
  }

  if (!canManageBilling.value) {
    toast.error("You do not have permission to manage billing for this team.")
    return
  }

  billingAction.value = "cancel"
  try {
    await cancelSubscriptionFn({
      teamId: currentTeam.value.id,
      when: "period_end",
    })
    await refreshBilling()
    toast.success("Subscription will cancel at period end.")
  } catch (error) {
    toast.error("Unable to cancel subscription.", {
      description: error instanceof Error ? error.message : String(error),
    })
  } finally {
    billingAction.value = null
  }
}

const restoreTeamSubscription = async (): Promise<void> => {
  if (!currentTeam.value?.id) {
    toast.error("Select a team before restoring.")
    return
  }

  if (!canManageBilling.value) {
    toast.error("You do not have permission to manage billing for this team.")
    return
  }

  if (isCancellationScheduled.value) {
    billingAction.value = "restore"
    try {
      await restoreSubscriptionFn({
        teamId: currentTeam.value.id,
      })
      await refreshBilling()
      toast.success("Subscription restored. Auto-renewal is active.")
    } catch (error) {
      toast.error("Unable to restore subscription.", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      billingAction.value = null
    }
    return
  }

  openPlansTab()
}

const handleSubscriptionAction = async (): Promise<void> => {
  if (canRestorePlan.value) {
    await restoreTeamSubscription()
    return
  }

  await cancelTeamSubscription()
}
</script>
<template>
  <div class="p-6">
    <FieldGroup>
      <FieldSet>
        <Field v-if="!canManageBilling" orientation="horizontal">
          <FieldContent>
            <div class="rounded-md border border-dashed p-6 text-sm">
              You do not have access to manage billing.
            </div>
          </FieldContent>
        </Field>
        <template v-else>
          <Item v-if="hasCurrentPlan" variant="muted" size="sm">
            <ItemMedia variant="icon">
              <IconBadgeDollarSign />
            </ItemMedia>
            <ItemContent class="gap-0.5 truncate">
              <ItemTitle class="truncate">
                {{ planLabel }}
                {{ intervalLabel }}
              </ItemTitle>
              <ItemDescription class="truncate text-xs">
                {{ billingLifecycleLabel }}
                &middot;
                {{ seatCountLabel }}
                ×
                {{
                  t("settings.billing.perSeat", {
                    price: currentPlanUnitPriceLabel,
                  })
                }}
                =
                {{ currentPlanTotalPriceLabel }}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button variant="outline" @click="openPlansTab">
                {{ t("settings.billing.changePlan.upgrade") }}
              </Button>
            </ItemActions>
          </Item>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="current-plan">
                {{ t("settings.billing.currentPlan.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ currentPlanDescriptionLabel }}
              </FieldDescription>
            </FieldContent>
            <Button
              variant="outline"
              :disabled="!canManageBilling"
              @click="openPlansTab"
            >
              {{ currentPlanButtonLabel }}
            </Button>
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="payment-method">
                {{ t("settings.billing.paymentMethod.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.billing.paymentMethod.description") }}
              </FieldDescription>
            </FieldContent>
            <Button
              variant="outline"
              :disabled="!canManagePortal || billingAction !== null"
              @click="openBillingPortal"
            >
              <Spinner v-if="billingAction === 'portal'" />
              {{ t("settings.billing.paymentMethod.button") }}
            </Button>
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="billing-history">
                {{ t("settings.billing.billingHistory.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.billing.billingHistory.description") }}
              </FieldDescription>
            </FieldContent>
            <Button
              variant="outline"
              :disabled="!canManagePortal || billingAction !== null"
              @click="openBillingPortal"
            >
              <Spinner v-if="billingAction === 'portal'" />
              {{ t("settings.billing.billingHistory.button") }}
            </Button>
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="upgrade-plan">
                {{ t("settings.billing.changePlan.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.billing.changePlan.description") }}
              </FieldDescription>
            </FieldContent>
            <Button
              variant="outline"
              :disabled="!canManageBilling"
              @click="openPlansTab"
            >
              {{ t("settings.billing.changePlan.button") }}
            </Button>
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="cancel-subscription"
                >Cancel subscription</FieldLabel
              >
              <FieldDescription>
                {{ subscriptionActionDescription }}
              </FieldDescription>
            </FieldContent>
            <Button
              variant="outline"
              :disabled="!canCancelSubscription && !canRestorePlan"
              @click="handleSubscriptionAction"
            >
              <Spinner
                v-if="billingAction === 'cancel' || billingAction === 'restore'"
              />
              <template v-else>
                {{ subscriptionActionLabel }}
              </template>
            </Button>
          </Field>
        </template>
      </FieldSet>
    </FieldGroup>
  </div>
</template>
