<script setup lang="ts">
import { columns } from "@/components/transactions/columns"
import tasks from "@/data/tasks.json"

useHead({
  title: "Transactions",
})

const selectedTab = ref("split")
</script>

<template>
  <div class="no-scrollbar flex max-h-fit overflow-y-auto p-2">
    <div class="grid grow gap-2">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <DateViewPicker />
          <Tabs v-model="selectedTab">
            <TabsList>
              <TabsTrigger value="split">
                <span class="flex items-center justify-center gap-2">
                  <icon-lucide-square-split-horizontal /> Split
                </span>
              </TabsTrigger>
              <TabsTrigger value="chart">
                <span class="flex items-center justify-center gap-2">
                  <icon-lucide-chart-pie /> Chart
                </span>
              </TabsTrigger>
              <TabsTrigger value="table">
                <span class="flex items-center justify-center gap-2">
                  <icon-lucide-table /> Table
                </span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div class="flex items-center gap-2">
          <NewTransaction />
        </div>
      </div>
      <DataChart v-if="selectedTab === 'chart' || selectedTab === 'split'" />
      <DataTable
        v-if="selectedTab === 'table' || selectedTab === 'split'"
        :data="tasks"
        :columns="columns"
      />
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
