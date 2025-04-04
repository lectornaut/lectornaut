<script setup lang="ts">
import { activity } from "@/data/chart"

const stats = [
  {
    name: "Total minutes",
    value: "24",
    change: "+5%",
    description:
      "Total minutes across all workflows in this organization for current month.",
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
      "Total job runs across all workflows in this organization for current month.",
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
      "Average time taken by a job to run across all workflows in this organization for current month.",
    changeType: "positive",
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
      "Average time taken by a job to get queued across all workflows in this organization for current month.",
    changeType: "positive",
    usage: 50,
    capacity: 10,
    unit: "seconds",
    showUpgrade: false,
  },
  {
    name: "Job failure rate",
    value: "10%",
    change: "+10%",
    description:
      "Percentage of jobs that failed across all workflows in this organization for current month.",
    changeType: "negative",
    usage: 90,
    capacity: 100,
    unit: "%",
    showUpgrade: true,
  },
  {
    name: "Failed job usage",
    value: "24",
    change: "+4%",
    description:
      "Total minutes across all workflows in this organization for current month.",
    changeType: "negative",
    usage: 85,
    capacity: 300,
    unit: "minutes",
    showUpgrade: true,
  },
]

const getUsagePercentage = (usage: number, capacity: number): number => {
  if (capacity === 0) return 0
  return Math.round((usage / capacity) * 100)
}
</script>

<template>
  <dl class="grid divide-y">
    <div>
      <Card class="border-0 shadow-none">
        <CardHeader>
          <CardTitle>
            <span class="truncate"> Runs </span>
          </CardTitle>
          <CardDescription>
            <div class="flex gap-2">
              <span class="flex items-center gap-1">
                <icon-mdi-circle-medium class="text-[MediumSlateBlue]" />
                <span class="text-xs text-[MediumSlateBlue]">
                  {{ Math.round(Math.random() * 100) }}
                  runs
                </span>
              </span>
              <span class="flex items-center gap-1">
                <icon-mdi-circle-medium class="text-[MediumOrchid]" />
                <span class="text-xs text-[MediumOrchid]">
                  {{ Math.round(Math.random() * 100) }}
                  jobs
                </span>
              </span>
              <span class="flex items-center gap-1">
                <icon-mdi-circle-medium class="text-[Crimson]" />
                <span class="text-xs text-[Crimson]">
                  {{ Math.round(Math.random() * 100) }}
                  errors
                </span>
              </span>
            </div>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LineChart
            class="-mx-5 h-16 w-0 min-w-[-webkit-fill-available] p-0"
            :data="activity"
            index="day"
            :categories="['runs', 'jobs', 'errors', 'duration']"
            :colors="[
              'MediumSlateBlue',
              'MediumOrchid',
              'Crimson',
              'MediumPurple',
            ]"
            :y-formatter="
              (tick, i) => {
                return typeof tick === 'number'
                  ? `$ ${new Intl.NumberFormat('us').format(tick).toString()}`
                  : ''
              }
            "
            :show-tooltip="false"
            :show-grid-line="false"
            :show-legend="false"
            :show-y-axis="false"
            :show-x-axis="false"
          />
        </CardContent>
        <CardFooter>
          <div class="flex w-full items-center">
            <div class="flex grow flex-col gap-1">
              <span class="text-muted-foreground truncate text-xs">
                First run
              </span>
              <span>
                {{
                  new Date().toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                }}
              </span>
            </div>
            <div class="flex grow flex-col gap-1">
              <span class="text-muted-foreground truncate text-xs">
                Last run
              </span>
              <span>
                {{
                  new Date().toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                }}
              </span>
            </div>
          </div>
        </CardFooter>
      </Card>
    </div>
    <div v-for="stat in stats" :key="stat.name">
      <Card class="border-0 shadow-none">
        <CardHeader>
          <CardTitle class="flex w-full justify-between">
            <span class="truncate"> {{ stat.name }} </span>
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
                <span class="truncate"> {{ stat.usage }} {{ stat.unit }} </span>
              </CardTitle>
              <CardDescription class="text-xs">
                {{ getUsagePercentage(stat.usage, stat.capacity) }}% used in
                billing cycle.
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
                  <span class="truncate">
                    {{ stat.usage }} {{ stat.unit }}
                  </span>
                  <span class="text-muted-foreground text-xs"> Used </span>
                </div>
                <Separator />
                <div class="flex grow flex-col items-center gap-1">
                  <span class="truncate">
                    {{ stat.capacity }} {{ stat.unit }}
                  </span>
                  <span class="text-muted-foreground text-xs"> Reserved </span>
                </div>
              </div>
            </CardFooter>
          </Card>
        </CardFooter>
      </Card>
    </div>
    <div>
      <Card class="border-0 shadow-none">
        <CardHeader class="gap-4">
          <CardTitle>
            <span class="truncate"> Information </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl class="flex flex-col gap-3">
            <div class="flex justify-between">
              <dt class="text-muted-foreground">Created by</dt>
              <dd>Marie Culver</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-muted-foreground">Created on</dt>
              <dd>June 8, 2020</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-muted-foreground">Last modified</dt>
              <dd>June 8, 2020</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-muted-foreground">Dimensions</dt>
              <dd>4032 x 3024</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-muted-foreground">Resolution</dt>
              <dd>72 x 72</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
    <div>
      <Card class="border-0 shadow-none">
        <CardHeader class="gap-4">
          <CardTitle>
            <span class="truncate">Description</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground truncate italic">
              Add a description.
            </span>
            <!-- <Button variant="secondary" size="icon">
              <icon-lucide-pencil />
            </Button> -->
          </div>
        </CardContent>
      </Card>
    </div>
    <div>
      <Card class="border-0 shadow-none">
        <CardHeader class="gap-4">
          <CardTitle>
            <span class="truncate">Shared with</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul role="list" class="flex flex-col gap-3">
            <li class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <img
                  src="https://images.unsplash.com/photo-1502685104226-ee32379fefbe?ixlib=rb-=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=3&w=1024&h=1024&q=80"
                  alt=""
                  class="size-6 rounded-full"
                />
                <p class="font-medium">Aimee Douglas</p>
              </div>
              <span class="text-muted-foreground truncate text-xs">Owner</span>
            </li>
            <li class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <img
                  src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?ixlib=rb-1.2.1&ixqx=oilqXxSqey&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80"
                  alt=""
                  class="size-6 rounded-full"
                />
                <p class="font-medium">Andrea McMillan</p>
              </div>
              <span class="text-muted-foreground truncate text-xs">Viewer</span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  </dl>
</template>
