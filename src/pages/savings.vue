<script lang="ts" setup>
useHead({
  title: "Savings",
})
</script>

<template>
  <div class="no-scrollbar flex grow flex-col overflow-auto overscroll-none">
    <div class="flex grow flex-col gap-2 p-2">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <DateViewPicker />
          <DateRangePicker />
        </div>
        <div class="flex items-center gap-2">
          <NewTransaction />
        </div>
      </div>
      <SavingsInsights />
      <SavingsTable />
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
