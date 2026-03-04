<script lang="ts" setup>
import { useBillingAccess } from "@/composables/useBillingAccess"
import {
  cancelSubscription as cancelSubscriptionFn,
  createBillingPortalSession as createBillingPortalSessionFn,
  restoreSubscription as restoreSubscriptionFn,
} from "@/composables/useFunctions"
import { useTeamActions } from "@/composables/useTeamActions"
import { hasActiveLikeBillingStatus } from "@/helpers/billing"
import {
  closePendingExternalTab,
  createPendingExternalTab,
  openExternalUrl,
} from "@/helpers/openExternalUrl"
import { emitter } from "@/modules/mitt"
import { toast } from "vue-sonner"

const { t } = useI18n()
const { canManageBilling, currentTeam } = useTeamActions()
const { billing, status, refreshBilling } = useBillingAccess()

const billingAction = ref<"portal" | "cancel" | "restore" | null>(null)

const hasActiveSubscription = computed(() => {
  return hasActiveLikeBillingStatus(status.value)
})

const planLabel = computed(() => {
  const planKey = billing.value?.planKey
  if (!planKey) return "No active subscription"
  return `${planKey.charAt(0).toUpperCase()}${planKey.slice(1)}`
})

const intervalLabel = computed(() => {
  if (billing.value?.interval === "month") return "Monthly"
  if (billing.value?.interval === "year") return "Annual"
  return "N/A"
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
      <FieldSet v-if="canManageBilling">
        <div
          class="bg-secondary text-secondary-foreground rounded border px-4 py-2"
        >
          {{ `${planLabel} • ${intervalLabel}` }}
          <br />
          {{ `Status: ${billing?.status ?? "none"}` }}
          <br />
          {{ billingLifecycleLabel }}
        </div>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="current-plan">
              {{ t("settings.billing.currentPlan.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.billing.currentPlan.description") }}
            </FieldDescription>
          </FieldContent>
          <Button
            variant="outline"
            :disabled="!canManageBilling"
            @click="openPlansTab"
          >
            {{ t("settings.billing.currentPlan.button") }}
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
              {{ t("settings.billing.upgradePlan.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.billing.upgradePlan.description") }}
            </FieldDescription>
          </FieldContent>
          <Button
            variant="outline"
            :disabled="!canManageBilling"
            @click="openPlansTab"
          >
            {{ t("settings.billing.upgradePlan.button") }}
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
      </FieldSet>
      <div v-else class="text-muted-foreground py-8 text-center">
        {{ t("settings.billing.noPermission") }}
      </div>
    </FieldGroup>
  </div>
</template>
