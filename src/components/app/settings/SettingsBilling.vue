<script lang="ts" setup>
import { useCanViewTeamSettings } from "@/composables/useCanViewTeamSettings"
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
import { useBillingStore } from "@/stores/billingStore"
import { storeToRefs } from "pinia"
import { toast } from "vue-sonner"

const { t } = useI18n()
const { canViewTeamSettings } = useCanViewTeamSettings()
const { canManageBilling, currentTeam, teamMembers } = useTeamActions()
const billingStore = useBillingStore()
void billingStore.ensureCatalogLoaded()
const { billing, catalog, isCatalogLoading, status } = storeToRefs(billingStore)
const { refreshBilling } = billingStore

type BillingActionTrigger =
  | "payment-method"
  | "billing-history"
  | "subscription-action"
  | "cancel-dialog"

const billingAction = ref<"portal" | "cancel" | "restore" | null>(null)
const activeBillingActionTrigger = ref<BillingActionTrigger | null>(null)
const isCancelSubscriptionDialogOpen = ref(false)

const hasActiveSubscription = computed(() => {
  return hasActiveLikeBillingStatus(status.value)
})

const currentPlanMeta = computed(() => {
  const planKey = billing.value?.planKey
  if (!planKey) return null
  return settingsPlans.find((plan) => plan.id === planKey) ?? null
})

const planLabel = computed(() => {
  if (!currentPlanMeta.value) return t("settings.billing.noActiveSubscription")
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
  if (billing.value?.interval === "month")
    return t("settings.billing.intervalMonthly")
  if (billing.value?.interval === "year")
    return t("settings.billing.intervalAnnual")
  return t("settings.billing.intervalNotAvailable")
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
  if (!planKey || !interval) return t("settings.billing.intervalNotAvailable")

  const price = catalog.value?.[planKey]?.[interval]
  if (!price?.currency || typeof price.unitAmount !== "number") {
    return isCatalogLoading.value
      ? t("settings.billing.loading")
      : t("settings.billing.unavailable")
  }

  const intervalSuffix = interval === "year" ? "/year" : "/month"
  return `${formatCurrencyAmount(price.unitAmount, price.currency)}${intervalSuffix}`
})

const currentPlanTotalPriceLabel = computed(() => {
  const planKey = billing.value?.planKey
  const interval = billing.value?.interval
  if (!planKey || !interval) return t("settings.billing.intervalNotAvailable")

  const price = catalog.value?.[planKey]?.[interval]
  if (!price?.currency || typeof price.unitAmount !== "number") {
    return isCatalogLoading.value
      ? t("settings.billing.loading")
      : t("settings.billing.unavailable")
  }

  const total = price.unitAmount * seatCount.value
  const intervalSuffix = interval === "year" ? "/year" : "/month"
  return `${formatCurrencyAmount(total, price.currency)}${intervalSuffix}`
})

const currentPeriodEndLabel = computed(() => {
  const currentPeriodEnd = billing.value?.currentPeriodEnd
  if (typeof currentPeriodEnd !== "number")
    return t("settings.billing.intervalNotAvailable")
  return useDateFormat(currentPeriodEnd * 1000, "MMM D, YYYY").value
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
  if (isCancelled.value) return t("settings.billing.lifecycleCancelled")

  const notAvailable = t("settings.billing.intervalNotAvailable")
  if (isCancellationScheduled.value) {
    if (currentPeriodEndLabel.value !== notAvailable) {
      return t("settings.billing.lifecycleScheduledOn", {
        date: currentPeriodEndLabel.value,
      })
    }
    return t("settings.billing.lifecycleScheduledPeriodEnd")
  }

  if (hasActiveSubscription.value) {
    if (currentPeriodEndLabel.value !== notAvailable) {
      return t("settings.billing.lifecycleRenewsOn", {
        date: currentPeriodEndLabel.value,
      })
    }
    return t("settings.billing.lifecycleAutoRenews")
  }

  return t("settings.billing.noActiveSubscription")
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
  if (canRestorePlan.value) return t("settings.billing.actionRestore")
  if (isCancelled.value) return t("settings.billing.actionCancelled")
  return t("settings.billing.actionCancel")
})

const subscriptionActionDescription = computed(() => {
  const notAvailable = t("settings.billing.intervalNotAvailable")
  if (isCancelled.value) {
    if (!hasActiveSubscription.value) {
      return t("settings.billing.actionDescriptionCancelledInactive")
    }
    return t("settings.billing.actionDescriptionCancelled")
  }

  if (isCancellationScheduled.value) {
    if (currentPeriodEndLabel.value !== notAvailable) {
      return t("settings.billing.actionDescriptionScheduledOn", {
        date: currentPeriodEndLabel.value,
      })
    }
    return t("settings.billing.actionDescriptionScheduledPeriodEnd")
  }

  if (hasActiveSubscription.value) {
    return t("settings.billing.actionDescriptionActive")
  }

  return t("settings.billing.actionDescriptionNone")
})

const cancelSubscriptionConfirmationDescription = computed(() => {
  const teamName = currentTeam.value?.name?.trim()
  const subject = teamName
    ? t("settings.billing.cancelConfirmSubjectTeam", { teamName })
    : t("settings.billing.cancelConfirmSubjectDefault")

  const notAvailable = t("settings.billing.intervalNotAvailable")
  if (currentPeriodEndLabel.value !== notAvailable) {
    return t("settings.billing.cancelConfirmUntilDate", {
      subject,
      date: currentPeriodEndLabel.value,
    })
  }

  return t("settings.billing.cancelConfirmAtPeriodEnd", { subject })
})

const openPlansTab = () => {
  emitter.emit("Dialog.Settings.Open", "plans")
}

const openBillingPortal = async (
  trigger: Extract<BillingActionTrigger, "payment-method" | "billing-history">
): Promise<void> => {
  if (!currentTeam.value?.id) {
    toast.error(t("settings.billing.toasts.selectTeamBeforeOpening"))
    return
  }

  if (!canManageBilling.value) {
    toast.error(t("settings.billing.toasts.noPermission"))
    return
  }

  if (!hasActiveSubscription.value) {
    toast.error(t("settings.billing.toasts.noActiveSubscription"))
    return
  }

  billingAction.value = "portal"
  activeBillingActionTrigger.value = trigger
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
    toast.error(t("settings.billing.toasts.portalFailed"), {
      description: error instanceof Error ? error.message : String(error),
    })
  } finally {
    billingAction.value = null
    activeBillingActionTrigger.value = null
  }
}

const cancelTeamSubscription = async (
  trigger: Extract<BillingActionTrigger, "cancel-dialog">
): Promise<boolean> => {
  if (!currentTeam.value?.id) {
    toast.error(t("settings.billing.toasts.selectTeamBeforeCancelling"))
    return false
  }

  if (!canManageBilling.value) {
    toast.error(t("settings.billing.toasts.noPermission"))
    return false
  }

  billingAction.value = "cancel"
  activeBillingActionTrigger.value = trigger
  try {
    await cancelSubscriptionFn({
      teamId: currentTeam.value.id,
      when: "period_end",
    })
    await refreshBilling()
    toast.success(t("settings.billing.toasts.cancelSuccess"))
    return true
  } catch (error) {
    toast.error(t("settings.billing.toasts.cancelFailed"), {
      description: error instanceof Error ? error.message : String(error),
    })
    return false
  } finally {
    billingAction.value = null
    activeBillingActionTrigger.value = null
  }
}

const restoreTeamSubscription = async (): Promise<void> => {
  if (!currentTeam.value?.id) {
    toast.error(t("settings.billing.toasts.selectTeamBeforeRestoring"))
    return
  }

  if (!canManageBilling.value) {
    toast.error(t("settings.billing.toasts.noPermission"))
    return
  }

  if (isCancellationScheduled.value) {
    billingAction.value = "restore"
    activeBillingActionTrigger.value = "subscription-action"
    try {
      await restoreSubscriptionFn({
        teamId: currentTeam.value.id,
      })
      await refreshBilling()
      toast.success(t("settings.billing.toasts.restoreSuccess"))
    } catch (error) {
      toast.error(t("settings.billing.toasts.restoreFailed"), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      billingAction.value = null
      activeBillingActionTrigger.value = null
    }
    return
  }

  openPlansTab()
}

const confirmCancelSubscription = async (): Promise<void> => {
  const didCancel = await cancelTeamSubscription("cancel-dialog")
  if (didCancel) {
    isCancelSubscriptionDialogOpen.value = false
  }
}

const handleSubscriptionAction = async (): Promise<void> => {
  if (canRestorePlan.value) {
    await restoreTeamSubscription()
    return
  }

  if (!currentTeam.value?.id || !canCancelSubscription.value) {
    return
  }

  isCancelSubscriptionDialogOpen.value = true
}
</script>
<template>
  <!-- Two-tier gate, matching the other admin pages: guests fail
       `canViewTeamSettings` and get the shared restriction wall; members who
       can view team settings but can't manage billing fall through to the
       inline admin Empty below. -->
  <div v-if="canViewTeamSettings" class="p-6">
    <FieldGroup>
      <FieldSet>
        <Field v-if="!canManageBilling" orientation="horizontal">
          <FieldContent>
            <Empty class="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconBadgeDollarSign />
                </EmptyMedia>
                <EmptyTitle>{{
                  t("settings.billing.noPermissionTitle")
                }}</EmptyTitle>
                <EmptyDescription>
                  {{ t("settings.billing.noPermissionDescription") }}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </FieldContent>
        </Field>
        <template v-else>
          <div class="border p-1">
            <Item v-if="hasCurrentPlan" variant="outline" class="bg-secondary">
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
            <Item v-else variant="outline" class="bg-secondary">
              <ItemMedia variant="icon">
                <IconBadgeDollarSign />
              </ItemMedia>
              <ItemContent class="gap-0.5 truncate">
                <ItemTitle class="truncate">
                  {{ t("settings.billing.noActivePlan") }}
                </ItemTitle>
                <ItemDescription class="truncate text-xs">
                  {{ t("settings.billing.noActivePlanDescription") }}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button variant="outline" @click="openPlansTab">
                  {{ t("settings.billing.currentPlan.subscribeButton") }}
                </Button>
              </ItemActions>
            </Item>
          </div>
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
              @click="openBillingPortal('payment-method')"
            >
              <Spinner
                v-if="
                  billingAction === 'portal' &&
                  activeBillingActionTrigger === 'payment-method'
                "
              />
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
              @click="openBillingPortal('billing-history')"
            >
              <Spinner
                v-if="
                  billingAction === 'portal' &&
                  activeBillingActionTrigger === 'billing-history'
                "
              />
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
              <FieldLabel for="cancel-subscription">
                {{ t("settings.billing.cancelSubscription.label") }}
              </FieldLabel>
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
                v-if="
                  billingAction === 'restore' &&
                  activeBillingActionTrigger === 'subscription-action'
                "
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
  <SettingsRestricted v-else />

  <AlertDialog v-model:open="isCancelSubscriptionDialogOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{
          t("settings.billing.cancelConfirmTitle")
        }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ cancelSubscriptionConfirmationDescription }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{
          t("settings.billing.cancelConfirmKeep")
        }}</AlertDialogCancel>
        <AlertDialogAction
          :disabled="billingAction === 'cancel'"
          @click.prevent="confirmCancelSubscription"
        >
          <Spinner
            v-if="
              billingAction === 'cancel' &&
              activeBillingActionTrigger === 'cancel-dialog'
            "
          />
          <template v-else>{{
            t("settings.billing.cancelConfirmCancel")
          }}</template>
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
