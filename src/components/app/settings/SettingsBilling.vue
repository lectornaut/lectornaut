<script lang="ts" setup>
import { useTeamActions } from "@/composables/useTeamActions"

const { t } = useI18n()
const { canManageBilling } = useTeamActions()
</script>

<template>
  <div class="p-6">
    <FieldGroup>
      <FieldSet v-if="canManageBilling">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="current-plan">
              {{ t("settings.billing.currentPlan.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.billing.currentPlan.description") }}
            </FieldDescription>
          </FieldContent>
          <Button variant="outline">
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
          <Button variant="outline">
            {{ t("settings.billing.paymentMethod.button") }}
          </Button>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="billing-address">
              {{ t("settings.billing.billingAddress.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.billing.billingAddress.description") }}
            </FieldDescription>
          </FieldContent>
          <Button variant="outline">
            {{ t("settings.billing.billingAddress.button") }}
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
          <Button variant="outline">
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
          <Button variant="outline">
            {{ t("settings.billing.upgradePlan.button") }}
          </Button>
        </Field>
      </FieldSet>
      <div v-else class="text-muted-foreground py-8 text-center">
        {{ t("settings.billing.noPermission") }}
      </div>
    </FieldGroup>
  </div>
</template>
