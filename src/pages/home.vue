<script setup lang="ts">
import { activity } from "@/data/chart"
import { DateFormatter, getLocalTimeZone, today } from "@internationalized/date"
import type { DateRange } from "reka-ui"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Home",
    breadcrumb: "Home",
  },
})

useHead({
  title: "Home",
})

const df = new DateFormatter("en-US", {
  dateStyle: "medium",
})

const presets = [
  {
    id: 0,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 0,
      }),
      end: today(getLocalTimeZone()),
    },
    label: "Today",
  },
  {
    id: 7,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 7,
      }),
      end: today(getLocalTimeZone()),
    },
    label: "Last 7 days",
  },
  {
    id: 14,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 14,
      }),
      end: today(getLocalTimeZone()),
    },
    label: "Last 14 days",
  },
  {
    id: 30,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 30,
      }),
      end: today(getLocalTimeZone()),
    },
    label: "Last 30 days",
  },
  {
    id: 90,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 90,
      }),
      end: today(getLocalTimeZone()),
    },
    label: "Last 3 months",
  },
  {
    id: 180,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 180,
      }),
      end: today(getLocalTimeZone()),
    },
    label: "Last 6 months",
  },
  {
    id: 365,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 365,
      }),
      end: today(getLocalTimeZone()),
    },
    label: "Last 1 year",
  },
]

const recentActivity = [
  {
    name: "John Doe",
    email: "john.doe@email.com",
    avatar: "/avatars/01.png",
    amount: "$1,999.00",
    initials: "JD",
  },
  {
    name: "Jackson Lee",
    email: "jackson.lee@email.com",
    avatar: "/avatars/02.png",
    amount: "$39.00",
    initials: "JL",
  },
  {
    name: "Isabella Nguyen",
    email: "isabella.nguyen@email.com",
    avatar: "/avatars/03.png",
    amount: "$299.00",
    initials: "IN",
  },
  {
    name: "William Kim",
    email: "william.kim@email.com",
    avatar: "/avatars/04.png",
    amount: "$99.00",
    initials: "WK",
  },
  {
    name: "Sofia Davis",
    email: "sofia.davis@email.com",
    avatar: "/avatars/05.png",
    amount: "$39.00",
    initials: "SD",
  },
]

const defaultRange = presets.find((preset) => preset.id === 0)!

const range = ref({
  start: defaultRange.value.start,
  end: defaultRange.value.end,
}) as Ref<DateRange>
</script>

<template>
  <div class="flex grow flex-col overflow-auto overscroll-none">
    <Tabs default-value="overview" class="gap-0">
      <div class="bg-background sticky top-0 z-10">
        <div class="flex items-center justify-between gap-2 p-2">
          <TabsList>
            <TabsTrigger value="overview"> Overview </TabsTrigger>
            <TabsTrigger value="usage"> Usage </TabsTrigger>
          </TabsList>
          <div class="flex items-center space-x-2">
            <Popover>
              <PopoverTrigger as-child>
                <Button variant="outline">
                  <icon-lucide-calendar />
                  {{
                    range.start
                      ? df.format(range.start.toDate(getLocalTimeZone()))
                      : "Start date"
                  }}
                  -
                  {{
                    range.end
                      ? df.format(range.end.toDate(getLocalTimeZone()))
                      : "End date"
                  }}
                </Button>
              </PopoverTrigger>
              <PopoverContent class="grid w-full p-0">
                <div class="p-2">
                  <Select v-model="range">
                    <SelectTrigger class="w-full">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        v-for="preset in presets"
                        :key="preset.id"
                        :value="preset.value"
                      >
                        {{ preset.label }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Separator />
                <RangeCalendar
                  v-model="range"
                  :max-value="today(getLocalTimeZone())"
                  initial-focus
                  class="p-2"
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <Separator />
      </div>
      <TabsContent
        value="overview"
        class="grid grid-cols-1 gap-2 p-2 md:grid-cols-2 lg:grid-cols-8"
      >
        <Card class="col-span-1 shadow-none md:col-span-1 lg:col-span-2">
          <CardHeader
            class="flex flex-row items-center justify-between space-y-0 pb-2"
          >
            <CardTitle class="text-sm font-medium"> Agents </CardTitle>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              class="text-muted-foreground h-4 w-4"
            >
              <path
                d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"
              />
            </svg>
          </CardHeader>
          <CardContent>
            <div class="text-2xl font-bold">$45,231.89</div>
            <p class="text-muted-foreground text-xs">+20.1% from last month</p>
          </CardContent>
        </Card>
        <Card class="col-span-1 shadow-none md:col-span-1 lg:col-span-2">
          <CardHeader
            class="flex flex-row items-center justify-between space-y-0 pb-2"
          >
            <CardTitle class="text-sm font-medium"> Performance </CardTitle>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              class="text-muted-foreground h-4 w-4"
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </CardHeader>
          <CardContent>
            <div class="text-2xl font-bold">+2350</div>
            <p class="text-muted-foreground text-xs">+180.1% from last month</p>
          </CardContent>
        </Card>
        <Card class="col-span-1 shadow-none md:col-span-1 lg:col-span-2">
          <CardHeader
            class="flex flex-row items-center justify-between space-y-0 pb-2"
          >
            <CardTitle class="text-sm font-medium"> Tasks </CardTitle>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              class="text-muted-foreground h-4 w-4"
            >
              <rect width="20" height="14" x="2" y="5" rx="2" />
              <path d="M2 10h20" />
            </svg>
          </CardHeader>
          <CardContent>
            <div class="text-2xl font-bold">+12,234</div>
            <p class="text-muted-foreground text-xs">+19% from last month</p>
          </CardContent>
        </Card>
        <Card class="col-span-1 shadow-none md:col-span-1 lg:col-span-2">
          <CardHeader
            class="flex flex-row items-center justify-between space-y-0 pb-2"
          >
            <CardTitle class="text-sm font-medium"> Efficiency </CardTitle>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              class="text-muted-foreground h-4 w-4"
            >
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </CardHeader>
          <CardContent>
            <div class="text-2xl font-bold">+573</div>
            <p class="text-muted-foreground text-xs">+201 since last hour</p>
          </CardContent>
        </Card>
        <Card class="col-span-1 shadow-none md:col-span-2 lg:col-span-4">
          <CardHeader>
            <CardTitle>Interactions</CardTitle>
          </CardHeader>
          <CardContent>
            <LineChart
              class="-mx-5 h-64 w-0 min-w-[-webkit-fill-available] p-0"
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
        </Card>
        <Card class="col-span-1 shadow-none md:col-span-2 lg:col-span-4">
          <CardHeader>
            <CardTitle>Recent</CardTitle>
            <CardDescription> You made 265 sales this month. </CardDescription>
          </CardHeader>
          <CardContent>
            <div class="space-y-8">
              <div
                v-for="sale in recentActivity"
                :key="sale.email"
                class="flex items-center"
              >
                <Avatar class="h-9 w-9">
                  <AvatarImage
                    :src="sale.avatar"
                    :alt="sale.name + ' Avatar'"
                  />
                  <AvatarFallback>{{ sale.initials }}</AvatarFallback>
                </Avatar>
                <div class="ml-4 space-y-1">
                  <p class="text-sm leading-none font-medium">
                    {{ sale.name }}
                  </p>
                  <p class="text-muted-foreground text-sm">
                    {{ sale.email }}
                  </p>
                </div>
                <div class="ml-auto font-medium">{{ sale.amount }}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="usage"> </TabsContent>
    </Tabs>
  </div>
</template>
