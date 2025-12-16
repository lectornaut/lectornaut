<script lang="ts" setup>
import { IconCircleCheck } from "@/data/icons"

definePage({
  meta: {
    layout: "landing",
  },
})

useHead({
  title: "Pricing",
})

const { t } = useI18n()

const billingDuration = computed(() => [
  {
    title: t("pages.pricing.billing.monthly"),
    value: "monthly",
  },
  {
    title: t("pages.pricing.billing.annual"),
    value: "annual",
  },
])

const activeBillingDuration = ref("monthly")

const pricingPlans = computed(() => [
  {
    title: t("pages.pricing.plans.personal.title"),
    id: "personal",
    monthlyPrice: t("pages.pricing.plans.personal.price"),
    annualPrice: t("pages.pricing.plans.personal.price"),
    overview: [
      t("pages.pricing.features.unlimitedConnections"),
      t("pages.pricing.features.professionalFeatures"),
      t("pages.pricing.features.communitySupport"),
    ],
    cta: t("pages.pricing.plans.cta.getStarted"),
    ctaLink: "/enter",
  },
  {
    title: t("pages.pricing.plans.professional.title"),
    id: "professional",
    monthlyPrice: t("pages.pricing.plans.professional.monthly"),
    annualPrice: t("pages.pricing.plans.professional.annual"),
    overview: [
      t("pages.pricing.features.everythingInPersonal"),
      t("pages.pricing.features.advancedFeatures"),
      t("pages.pricing.features.prioritySupport"),
    ],
    cta: t("pages.pricing.plans.cta.getStarted"),
    ctaLink: "/enter",
  },
  {
    title: t("pages.pricing.plans.business.title"),
    id: "business",
    monthlyPrice: t("pages.pricing.plans.business.monthly"),
    annualPrice: t("pages.pricing.plans.business.annual"),
    overview: [
      t("pages.pricing.features.everythingInProfessional"),
      t("pages.pricing.features.teamManagement"),
      t("pages.pricing.features.enhancedSecurity"),
      t("pages.pricing.features.customizableWorkflows"),
      t("pages.pricing.features.analyticsAndReporting"),
      t("pages.pricing.features.dedicatedSupport"),
    ],
    cta: t("pages.pricing.plans.cta.getStarted"),
    ctaLink: "/enter",
  },
  {
    title: t("pages.pricing.plans.enterprise.title"),
    id: "enterprise",
    monthlyPrice: t("pages.pricing.plans.enterprise.price"),
    annualPrice: t("pages.pricing.plans.enterprise.price"),
    overview: [
      // "Everything in Business"
      t("pages.pricing.features.customSLAs"),
      t("pages.pricing.features.dedicatedAccountManager"),
      t("pages.pricing.features.integrationSupport"),
      t("pages.pricing.features.complianceAndAudits"),
    ],
    cta: t("pages.pricing.plans.cta.contactSales"),
    ctaLink: "/contact",
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
        <TabsList class="mx-auto">
          <TabsTrigger
            v-for="item in billingDuration"
            :key="item.value"
            :value="item.value"
          >
            {{ item.title }}
          </TabsTrigger>
        </TabsList>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          <Card v-for="(card, index) in pricingPlans" :key="index">
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
              <Button as-child>
                <RouterLink :to="card.ctaLink">
                  {{ card.cta }}
                </RouterLink>
              </Button>
            </CardFooter>
          </Card>
        </div>
      </Tabs>
    </div>
    <div class="px-8 py-4">
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
</template>
