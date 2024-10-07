<script lang="ts" setup>
import { columns } from "@/components/transactions/columns"
import tasks from "@/data/tasks.json"

useHead({
  title: "Transactions",
})

const selectedTab = ref("chart")
</script>

<template>
  <div class="no-scrollbar flex grow flex-col overflow-auto overscroll-none">
    <div class="flex grow flex-col gap-2 p-2">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <DateViewPicker />
          <Tabs v-model="selectedTab">
            <TabsList>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <TabsTrigger value="chart">
                      <span class="flex h-4 items-center justify-center gap-2">
                        <icon-lucide-chart-pie />
                      </span>
                    </TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent> Chart view </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <TabsTrigger value="table">
                      <span class="flex h-4 items-center justify-center gap-2">
                        <icon-lucide-table />
                      </span>
                    </TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent> Table view </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </TabsList>
          </Tabs>
          <DateRangePicker />
        </div>
        <div class="flex items-center gap-2">
          <NewTransaction />
        </div>
      </div>
      <DataChart v-if="selectedTab === 'chart'" />
      <DataTable
        v-else-if="selectedTab === 'table'"
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
