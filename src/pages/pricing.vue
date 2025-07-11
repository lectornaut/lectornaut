<script setup lang="ts">
definePage({
  meta: {
    layout: "landing",
  },
})

useHead({
  title: "Pricing",
})

const billingDuration = [
  {
    title: "Monthly",
    value: "monthly",
  },
  {
    title: "Annual",
    value: "annual",
  },
]

const activeBillingDuration = ref("monthly")

const pricingPlans = [
  {
    title: "Personal",
    id: "personal",
    monthlyPrice: "Free for everyone",
    annualPrice: "Free for everyone",
    overview: [
      "Unlimited connections",
      "Professional features",
      "Community support",
    ],
    cta: "Get Started",
    ctaLink: "/enter",
  },
  {
    title: "Professional",
    id: "professional",
    monthlyPrice: "$10/month",
    annualPrice: "$8/month",
    overview: [
      "Everything in Personal",
      "Advanced features",
      "Priority support",
    ],
    cta: "Get Started",
    ctaLink: "/enter",
  },
  {
    title: "Business",
    id: "business",
    monthlyPrice: "$16/user/month",
    annualPrice: "$14/user/month",
    overview: [
      "Everything in Professional",
      "Team management",
      "Enhanced security",
      "Customizable workflows",
      "Analytics and reporting",
      "Dedicated support",
    ],
    cta: "Get Started",
    ctaLink: "/enter",
  },
  {
    title: "Enterprise",
    id: "enterprise",
    monthlyPrice: "Contact us",
    annualPrice: "Contact us",
    overview: [
      "Everything in Business",
      "Custom SLAs",
      "Dedicated account manager",
      "Integration support",
      "Compliance and audits",
    ],
    cta: "Contact Sales",
    ctaLink: "/contact",
  },
]

const comparisonPlans = [
  {
    feature: "Agents",
    personal: "5 agents",
    professional: "10 agents",
    business: "Unlimited agents",
    enterprise: "Unlimited agents",
  },
  {
    feature: "Members",
    personal: "1 member",
    professional: "1 member",
    business: "Unlimited members",
    enterprise: "Unlimited members",
  },
  {
    feature: "Teams",
    personal: "2 teams",
    professional: "5 teams",
    business: "Unlimited teams",
    enterprise: "Unlimited teams",
  },
  {
    feature: "Storage",
    personal: "10 MB/month",
    professional: "100 MB/month",
    business: "1 GB/month",
    enterprise: "Unlimited storage",
  },
  {
    feature: "Workflows",
    personal: "10 runs/month",
    professional: "100 runs/month",
    business: "500 runs/month",
    enterprise: "Unlimited runs",
  },
  {
    feature: "Authentication",
    personal: "OAuth and SFA",
    professional: "OAuth, SFA, and MFA",
    business: "OAuth, SFA, MFA, and SSO",
    enterprise: "OAuth, SFA, MFA, SSO, and OIDC",
  },
  {
    feature: "Support",
    personal: "Community support",
    professional: "Email support",
    business: "Priority support",
    enterprise: "Dedicated support",
  },
  {
    feature: "Integrations",
    personal: "No",
    professional: "Yes",
    business: "Yes",
    enterprise: "Yes",
  },
  {
    feature: "API Access",
    personal: "No",
    professional: "Yes",
    business: "Yes",
    enterprise: "Yes",
  },
  {
    feature: "Account Manager",
    personal: "No",
    professional: "No",
    business: "Yes",
    enterprise: "Yes",
  },
  {
    feature: "Analytics and Reporting",
    personal: "No",
    professional: "No",
    business: "Yes",
    enterprise: "Yes",
  },
  {
    feature: "Audit Log",
    personal: "No",
    professional: "No",
    business: "No",
    enterprise: "Yes",
  },
  {
    feature: "SCIM Provisioning",
    personal: "No",
    professional: "No",
    business: "No",
    enterprise: "Yes",
  },
  {
    feature: "Compliance and Audits",
    personal: "No",
    professional: "No",
    business: "No",
    enterprise: "Yes",
  },
  {
    feature: "Uptime SLA",
    personal: "No",
    professional: "No",
    business: "No",
    enterprise: "Yes",
  },
]
</script>

<template>
  <div class="mx-auto my-32 grid max-w-6xl gap-10">
    <div class="space-y-6 text-center">
      <h2 class="font-display text-6xl font-bold">Pricing</h2>
      <p class="text-secondary-foreground">
        Choose the plan that fits your needs. All plans come with a 14-day
        personal trial. Cancel anytime.
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
                  <icon-lucide-circle-check />
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
            <TableHead> Feature </TableHead>
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
