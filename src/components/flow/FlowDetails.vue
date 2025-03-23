<script lang="ts" setup>
const stats = [
  {
    name: "Total minutes",
    value: "24",
    change: "+5%",
    description:
      "Total minutes across all workflows in this organization for current month",
    changeType: "positive",
    usage: 12,
    capacity: 50,
    unit: "mins",
    showUpgrade: true,
  },
  {
    name: "Total job runs",
    value: "12",
    change: "-2%",
    description:
      "Total job runs across all workflows in this organization for current month",
    changeType: "negative",
    usage: 60,
    capacity: 20,
    unit: "runs",
    showUpgrade: false,
  },
  {
    name: "Avg job run time",
    value: "1m 19s",
    change: "+3s",
    description:
      "Average run time of jobs in this organization for current month",
    changeType: "neutral",
    usage: 70,
    capacity: 2,
    unit: "seconds",
    showUpgrade: false,
  },
  {
    name: "Avg job queue time",
    value: "4s",
    change: "-1s",
    description:
      "Average queue time of jobs in this organization for current month",
    changeType: "positive",
    usage: 50,
    capacity: 10,
    unit: "seconds",
    showUpgrade: false,
  },
  {
    name: "Job failure rate",
    value: "100",
    change: "+10%",
    description:
      "Failure rate across jobs in this organization for current month",
    changeType: "negative",
    usage: 90,
    capacity: 100,
    unit: "%",
    showUpgrade: false,
  },
  {
    name: "Failed job usage",
    value: "24",
    change: "+4%",
    description:
      "Total minutes used across failed jobs in this organization for current month",
    changeType: "negative",
    usage: 85,
    capacity: 30,
    unit: "minutes",
    showUpgrade: false,
  },
]

const getUsagePercentage = (usage: number, capacity: number): number => {
  if (capacity === 0) return 0
  return Math.round((usage / capacity) * 100)
}
</script>

<template>
  <dl class="grid divide-y">
    <div v-for="stat in stats" :key="stat.name" class="flex flex-col gap-4 p-6">
      <div class="flex items-center justify-between">
        <dt class="text-secondary-foreground font-medium">{{ stat.name }}</dt>
        <dd
          :class="[
            stat.changeType === 'negative' ? 'text-red-600' : 'text-green-700',
            'text-xs font-medium',
          ]"
        >
          {{ stat.change }}
        </dd>
      </div>
      <dd class="w-full text-2xl font-medium tracking-tight">
        {{ stat.value }}
      </dd>
      <p class="text-muted-foreground mb-2 w-full text-xs text-balance">
        {{ stat.description }}
      </p>
      <Card v-if="stat.showUpgrade" class="shadow-none">
        <CardHeader class="p-4">
          <CardTitle
            class="flex items-center justify-between text-base font-medium"
          >
            <span class="truncate"> {{ stat.usage }} {{ stat.unit }} </span>
            <Badge variant="secondary" class="gap-2 p-1 pl-2">
              <span class="truncate"> Upgrade </span>
              <icon-mdi-arrow-right-circle />
            </Badge>
          </CardTitle>
          <CardDescription class="line-clamp-1">
            {{ getUsagePercentage(stat.usage, stat.capacity) }}% used from
            {{ stat.capacity }} {{ stat.unit }}
          </CardDescription>
        </CardHeader>
        <CardContent class="px-4 pt-2">
          <Progress
            :model-value="getUsagePercentage(stat.usage, stat.capacity)"
            class="h-2"
          />
        </CardContent>
        <Separator />
        <CardFooter class="p-0">
          <div class="flex h-16 w-full items-center">
            <div class="flex grow flex-col items-center gap-1">
              <span class="truncate"> {{ stat.usage }} {{ stat.unit }} </span>
              <span class="text-muted-foreground text-xs"> Used </span>
            </div>
            <Separator orientation="vertical" />
            <div class="flex grow flex-col items-center gap-1">
              <span class="truncate">
                {{ stat.capacity }} {{ stat.unit }}
              </span>
              <span class="text-muted-foreground text-xs"> Reserved </span>
            </div>
          </div>
        </CardFooter>
      </Card>
    </div>
  </dl>
</template>
