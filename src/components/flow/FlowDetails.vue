<script lang="ts" setup>
import { dailyActivity } from "@/data/chart"
import { IconCircleMedium } from "@/data/icons"

const { t } = useI18n()
const currentDate = new Date()
const currentDateLabel = useDateFormat(currentDate, "D MMM YYYY")

const stats = computed(() => [
  {
    name: t("components.flow.stats.totalMinutes"),
    value: "24",
    change: "+5%",
    description: t("components.flow.stats.totalMinutesDescription"),
    changeType: "positive",
    usage: 12,
    capacity: 50,
    unit: t("components.flow.stats.unitMins"),
    showUpgrade: true,
  },
  {
    name: t("components.flow.stats.totalJobRuns"),
    value: "12",
    change: "-2%",
    description: t("components.flow.stats.totalJobRunsDescription"),
    changeType: "negative",
    usage: 60,
    capacity: 20,
    unit: t("components.flow.stats.unitRuns"),
    showUpgrade: false,
  },
  {
    name: t("components.flow.stats.avgJobRunTime"),
    value: "1m 19s",
    change: "+3s",
    description: t("components.flow.stats.avgJobRunTimeDescription"),
    changeType: "positive",
    usage: 70,
    capacity: 2,
    unit: t("components.flow.stats.unitSeconds"),
    showUpgrade: false,
  },
  {
    name: t("components.flow.stats.avgJobQueueTime"),
    value: "4s",
    change: "-1s",
    description: t("components.flow.stats.avgJobQueueTimeDescription"),
    changeType: "positive",
    usage: 50,
    capacity: 10,
    unit: t("components.flow.stats.unitSeconds"),
    showUpgrade: false,
  },
  {
    name: t("components.flow.stats.jobFailureRate"),
    value: "10%",
    change: "+10%",
    description: t("components.flow.stats.jobFailureRateDescription"),
    changeType: "negative",
    usage: 90,
    capacity: 100,
    unit: "%",
    showUpgrade: true,
  },
  {
    name: t("components.flow.stats.failedJobUsage"),
    value: "24",
    change: "+4%",
    description: t("components.flow.stats.totalMinutesDescription"),
    changeType: "negative",
    usage: 85,
    capacity: 300,
    unit: t("components.flow.stats.unitMinutes"),
    showUpgrade: true,
  },
])

const getUsagePercentage = (usage: number, capacity: number): number => {
  if (capacity === 0) return 0
  return Math.round((usage / capacity) * 100)
}
</script>

<template>
  <div class="grid">
    <SidebarGroup>
      <SidebarGroupContent>
        <Card class="shadow-none">
          <CardHeader>
            <CardTitle>
              <span> {{ t("settings.titles.runs") }} </span>
            </CardTitle>
            <CardDescription>
              <div class="flex gap-2">
                <span class="flex items-center gap-1">
                  <IconCircleMedium class="text-[MediumSlateBlue]" />
                  <span class="text-xs text-[MediumSlateBlue]">
                    {{ Math.round(Math.random() * 100) }}
                    {{ t("components.flow.details.runsUnit") }}
                  </span>
                </span>
                <span class="flex items-center gap-1">
                  <IconCircleMedium class="text-[MediumOrchid]" />
                  <span class="text-xs text-[MediumOrchid]">
                    {{ Math.round(Math.random() * 100) }}
                    {{ t("components.flow.details.jobsUnit") }}
                  </span>
                </span>
                <span class="flex items-center gap-1">
                  <IconCircleMedium class="text-[Crimson]" />
                  <span class="text-xs text-[Crimson]">
                    {{ Math.round(Math.random() * 100) }}
                    {{ t("components.flow.details.errorsUnit") }}
                  </span>
                </span>
              </div>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LineChart
              class="-mx-5 h-32 min-w-[-webkit-fill-available]"
              :data="dailyActivity"
              index="day"
              :categories="['runs', 'jobs', 'errors', 'duration']"
              :colors="[
                'var(--color-chart-1)',
                'var(--color-chart-2)',
                'var(--color-chart-3)',
                'var(--color-chart-4)',
                'var(--color-chart-5)',
              ]"
              :y-formatter="
                (tick: string | number | bigint) => {
                  return typeof tick === 'number'
                    ? `$ ${new Intl.NumberFormat('us').format(tick).toString()}`
                    : ''
                }
              "
              :show-tooltip="false"
              :show-grid-line="false"
              :show-legend="false"
              :show-x-axis="false"
              :show-y-axis="false"
            />
          </CardContent>
          <CardFooter>
            <div class="flex w-full items-center">
              <div class="flex grow flex-col gap-1">
                <span class="text-muted-foreground truncate text-xs">
                  {{ t("components.flow.details.firstRun") }}
                </span>
                <span>
                  {{ currentDateLabel }}
                </span>
              </div>
              <div class="flex grow flex-col gap-1">
                <span class="text-muted-foreground truncate text-xs">
                  {{ t("components.flow.details.lastRun") }}
                </span>
                <span>
                  {{ currentDateLabel }}
                </span>
              </div>
            </div>
          </CardFooter>
        </Card>
      </SidebarGroupContent>
    </SidebarGroup>
    <SidebarGroup v-for="stat in stats" :key="stat.name">
      <SidebarGroupContent>
        <Card class="shadow-none">
          <CardHeader>
            <CardTitle class="flex w-full justify-between">
              <span> {{ stat.name }} </span>
              <span
                :class="[
                  stat.changeType === 'negative'
                    ? 'text-red-600'
                    : 'text-green-600',
                  'text-xs font-medium',
                ]"
              >
                {{ stat.change }}
              </span>
            </CardTitle>
            <div class="w-full text-2xl font-medium tracking-tight">
              {{ stat.value }}
            </div>
            <CardDescription class="text-xs">
              {{ stat.description }}
            </CardDescription>
          </CardHeader>
          <CardFooter v-if="stat.showUpgrade">
            <Card class="w-full shadow-none">
              <CardHeader>
                <CardTitle>
                  <span> {{ stat.usage }} {{ stat.unit }} </span>
                </CardTitle>
                <CardDescription class="text-xs">
                  {{ getUsagePercentage(stat.usage, stat.capacity) }}%
                  {{ t("components.flow.details.usedInBillingCycle") }}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Progress
                  :model-value="getUsagePercentage(stat.usage, stat.capacity)"
                  class="h-1.5"
                />
              </CardContent>
              <Separator />
              <CardFooter class="px-0">
                <div class="flex w-full flex-col gap-6">
                  <div class="flex grow flex-col items-center gap-1">
                    <span> {{ stat.usage }} {{ stat.unit }} </span>
                    <span> {{ t("components.flow.details.used") }} </span>
                  </div>
                  <Separator />
                  <div class="flex grow flex-col items-center gap-1">
                    <span> {{ stat.capacity }} {{ stat.unit }} </span>
                    <span> {{ t("components.flow.details.reserved") }} </span>
                  </div>
                </div>
              </CardFooter>
            </Card>
          </CardFooter>
        </Card>
      </SidebarGroupContent>
    </SidebarGroup>
    <SidebarGroup>
      <SidebarGroupContent>
        <Card class="shadow-none">
          <CardHeader class="gap-4">
            <CardTitle>
              <span> {{ t("labels.information") }} </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl class="flex flex-col gap-2">
              <div class="flex justify-between">
                <dt class="text-muted-foreground">
                  {{ t("labels.createdBy") }}
                </dt>
                <dd>Marie Culver</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-muted-foreground">
                  {{ t("labels.createdOn") }}
                </dt>
                <dd>June 8, 2020</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-muted-foreground">
                  {{ t("labels.lastModified") }}
                </dt>
                <dd>June 8, 2020</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-muted-foreground">
                  {{ t("labels.dimensions") }}
                </dt>
                <dd>4032 x 3024</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-muted-foreground">
                  {{ t("labels.resolution") }}
                </dt>
                <dd>72 x 72</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </SidebarGroupContent>
    </SidebarGroup>
    <SidebarGroup>
      <SidebarGroupContent>
        <Card class="shadow-none">
          <CardHeader class="gap-4">
            <CardTitle>
              <span>{{ t("labels.description") }}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div class="flex items-center justify-between">
              <span class="text-muted-foreground truncate italic">
                {{ t("components.flow.details.addDescription") }}
              </span>
              <!-- <Button variant="secondary" size="icon">
              <IconPencil />
            </Button> -->
            </div>
          </CardContent>
        </Card>
      </SidebarGroupContent>
    </SidebarGroup>
    <SidebarGroup>
      <SidebarGroupContent>
        <Card class="shadow-none">
          <CardHeader class="gap-4">
            <CardTitle>
              <span>{{ t("labels.sharedWith") }}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul role="list" class="flex flex-col gap-2">
              <li class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <img
                    src="https://images.unsplash.com/photo-1502685104226-ee32379fefbe?ixlib=rb-=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=3&w=1024&h=1024&q=80"
                    alt=""
                    class="size-6"
                  />
                  <p class="font-medium">Aimee Douglas</p>
                </div>
                <span class="text-muted-foreground truncate text-xs">{{
                  t("labels.owner")
                }}</span>
              </li>
              <li class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <img
                    src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?ixlib=rb-1.2.1&ixqx=oilqXxSqey&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80"
                    alt=""
                    class="size-6"
                  />
                  <p class="font-medium">Andrea McMillan</p>
                </div>
                <span class="text-muted-foreground truncate text-xs">{{
                  t("labels.viewer")
                }}</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </SidebarGroupContent>
    </SidebarGroup>
  </div>
</template>
