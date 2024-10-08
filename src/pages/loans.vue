<template>
  <div class="no-scrollbar flex grow flex-col overflow-auto overscroll-none">
    <div class="flex grow flex-col gap-2 p-2">
      <LoanInsights />
      <LoanTable />
    </div>
  </div>
</template>

<route lang="json">
{
  "meta": {
    "layout": "app",
    "requiresUser": true
  }
}
</route>
