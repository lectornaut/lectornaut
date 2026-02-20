<script lang="ts" setup>
import { useTeamActions } from "@/composables/useTeamActions"
import { IconCheck, IconChevronDown, IconMinus } from "@/data/icons"

const { t } = useI18n()
const { canManageBilling } = useTeamActions()

// Subscription Plans Logic
const billingCycle = ref<"annually" | "monthly">("annually")
const tableBillingCycle = ref<"annually" | "monthly">("annually")
const currentPlanId = ref("personal") // Mocked for now

const getPrice = (baseAnnuallyPrice: number, cycle: "annually" | "monthly") => {
  return cycle === "annually" ? baseAnnuallyPrice : baseAnnuallyPrice * 1.25
}

const availablePlans = computed(() => [
  {
    id: "personal",
    titleKey: "settings.plans.subscriptionPlan.personal.title",
    descriptionKey: "settings.plans.subscriptionPlan.personal.description",
    baseAnnuallyPrice: 10,
    price: getPrice(10, billingCycle.value),
    highlights: [
      "Personal Workspaces",
      "10 Agents",
      "100 Monthly Tasks",
      "100 Monthly Runs",
      "10GB Storage",
    ],
  },
  {
    id: "professional",
    titleKey: "settings.plans.subscriptionPlan.professional.title",
    descriptionKey: "settings.plans.subscriptionPlan.professional.description",
    baseAnnuallyPrice: 20,
    price: getPrice(20, billingCycle.value),
    highlights: [
      "Team Workspaces",
      "100 Agents",
      "1000 Monthly Tasks",
      "1000 Monthly Runs",
      "100GB Storage",
      "Latest AI Models",
    ],
  },
  {
    id: "business",
    titleKey: "settings.plans.subscriptionPlan.business.title",
    descriptionKey: "settings.plans.subscriptionPlan.business.description",
    baseAnnuallyPrice: 30,
    price: getPrice(30, billingCycle.value),
    highlights: [
      "Team Workspaces",
      "500 Agents",
      "5000 Monthly Tasks",
      "5000 Monthly Runs",
      "500GB Storage",
      "Latest AI Models",
      "Custom Domains",
      "Custom AI Models",
    ],
  },
  {
    id: "enterprise",
    titleKey: "settings.plans.subscriptionPlan.enterprise.title",
    descriptionKey: "settings.plans.subscriptionPlan.enterprise.description",
    baseAnnuallyPrice: 40,
    price: getPrice(40, billingCycle.value),
    highlights: [
      "Team Workspaces",
      "1000 Agents",
      "10000 Monthly Tasks",
      "10000 Monthly Runs",
      "1000GB Storage",
      "Latest AI Models",
      "Custom Domains",
      "Custom AI Models",
      "Custom SLA",
      "Priority Support",
    ],
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

const getPlanStatus = (planId: string) => {
  const plans = ["personal", "professional", "business", "enterprise"]
  const currentIndex = plans.indexOf(currentPlanId.value)
  const planIndex = plans.indexOf(planId)

  if (planId === currentPlanId.value) return "current"
  if (planIndex > currentIndex) return "upgrade"
  return "downgrade"
}

const getButtonVariant = (planId: string) => {
  const status = getPlanStatus(planId)
  if (status === "current") return "secondary"

  const plans = ["personal", "professional", "business", "enterprise"]
  const currentIndex = plans.indexOf(currentPlanId.value)
  // Next plan gets default highlight
  if (plans.indexOf(planId) === currentIndex + 1) return "default"

  return status === "downgrade" ? "ghost" : "outline"
}

const getButtonLabel = (planId: string) => {
  const status = getPlanStatus(planId)
  if (status === "current") return "Active"
  if (status === "upgrade") return "Upgrade"
  return "Downgrade"
}
</script>

<template>
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
          </FieldContent>
          <RadioGroup
            :model-value="currentPlanId"
            class="grid grid-cols-4 gap-2"
            :disabled="!canManageBilling"
            @update:model-value="
              (val) => val && (currentPlanId = val as string)
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
                  ${{ plan.price }} per user per month <br />
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
                            'bg-background after:border-primary relative z-20 rounded-t-lg after:absolute after:inset-0 after:z-10 after:rounded-t-lg after:border-x after:border-t':
                              currentPlanId === plan.id,
                          }"
                        >
                          <span class="font-semibold">
                            {{ t(plan.titleKey) }}
                          </span>
                          <br />
                          <span class="text-muted-foreground text-xs">
                            ${{
                              getPrice(
                                plan.baseAnnuallyPrice,
                                tableBillingCycle
                              )
                            }}/user/mo
                            <br />
                            Billed {{ tableBillingCycle }}
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
                            'bg-background after:border-primary relative z-20 p-2 after:absolute after:inset-x-0 after:-inset-y-px after:z-10 after:border-x':
                              currentPlanId === plan.id,
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
                              :model-value="tableBillingCycle === 'annually'"
                              @update:model-value="
                                (val) =>
                                  (tableBillingCycle = val
                                    ? 'annually'
                                    : 'monthly')
                              "
                            />
                            <Label
                              for="annual-mode-table"
                              class="text-muted-foreground text-xs"
                            >
                              Annually (25% off)
                            </Label>
                          </div>
                        </TableCell>
                        <TableCell
                          v-for="plan in availablePlans"
                          :key="plan.id"
                          :class="{
                            'bg-background after:border-primary relative z-20 rounded-b-lg p-2 after:absolute after:inset-0 after:z-10 after:rounded-b-lg after:border-x after:border-b':
                              currentPlanId === plan.id,
                          }"
                        >
                          <Button
                            size="sm"
                            class="w-full shadow-none"
                            :variant="getButtonVariant(plan.id)"
                            :disabled="
                              getPlanStatus(plan.id) === 'current' ||
                              !canManageBilling
                            "
                          >
                            {{ getButtonLabel(plan.id) }}
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
</template>
