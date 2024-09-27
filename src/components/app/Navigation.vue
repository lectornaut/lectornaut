<script lang="ts" setup>
import IconTransactions from "~icons/lucide/arrow-left-right"
import IconLoans from "~icons/lucide/coins"
import IconHome from "~icons/lucide/home"
import IconAccounts from "~icons/lucide/landmark"
import IconSavings from "~icons/lucide/piggy-bank"

const links = [
  {
    title: "Home",
    label: "Systems Operational",
    icon: IconHome,
    to: "/home",
  },
  {
    title: "Transactions",
    label: "Systems Operational",
    icon: IconTransactions,
    to: "/transactions",
  },
  {
    title: "Savings",
    label: "Systems Operational",
    icon: IconSavings,
    to: "/savings",
  },
  {
    title: "Loans",
    label: "Systems Operational",
    icon: IconLoans,
    to: "/loans",
  },
  {
    title: "Accounts",
    label: "Systems Operational",
    icon: IconAccounts,
    to: "/accounts",
  },
]
</script>

<template>
  <nav class="flex flex-col gap-1">
    <template v-for="(link, index) of links" :key="`1-${index}`">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <RouterLink v-slot="{ isActive }" :to="link.to" class="flex grow">
              <Button
                :variant="isActive ? '' : 'ghost'"
                class="grow justify-start gap-3 truncate"
                size="sm"
              >
                <Component :is="link.icon" />
                <span class="truncate">{{ link.title }}</span>
              </Button>
            </RouterLink>
          </TooltipTrigger>
          <TooltipContent side="right" class="flex items-center gap-2">
            {{ link.title }}
            <span class="ml-auto text-muted-foreground">
              {{ link.label }}
            </span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </template>
  </nav>
</template>
