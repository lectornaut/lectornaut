<script lang="ts" setup>
import IconTransactions from "~icons/lucide/arrow-left-right"
import IconLoans from "~icons/lucide/coins"
import IconHome from "~icons/lucide/home"
import IconAccounts from "~icons/lucide/landmark"
import IconSavings from "~icons/lucide/piggy-bank"
import IconBalances from "~icons/lucide/wallet-minimal"

const links = [
  {
    title: "Home",
    label: "Systems Operational",
    icon: IconHome,
    to: "/home",
  },
  {
    title: "Balances",
    label: "Systems Operational",
    icon: IconBalances,
    to: "/balances",
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
  <nav class="flex flex-col p-2">
    <TooltipProvider>
      <template v-for="(link, index) of links" :key="`1-${index}`">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              class="grow justify-start gap-3 truncate font-normal text-muted-foreground"
              size="sm"
              as-child
            >
              <RouterLink :to="link.to">
                <Component :is="link.icon" />
                <span class="truncate">{{ link.title }}</span>
              </RouterLink>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" class="flex items-center gap-2">
            {{ link.title }}
            <span class="text-muted-foreground">
              {{ link.label }}
            </span>
          </TooltipContent>
        </Tooltip>
      </template>
    </TooltipProvider>
  </nav>
</template>

<style lang="scss" scoped>
.router-link-exact-active,
.router-link-active {
  @apply bg-primary;
  @apply text-primary-foreground;
  @apply hover:bg-primary/90;
}
</style>
