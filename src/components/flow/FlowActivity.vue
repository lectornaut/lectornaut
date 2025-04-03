<script setup lang="ts">
import { DateFormatter, getLocalTimeZone, today } from "@internationalized/date"
import type { DateRange } from "reka-ui"
import AlertTriangle from "~icons/lucide/alert-triangle"
import Ban from "~icons/lucide/ban"
import CheckCircle from "~icons/lucide/check-circle"
import Circle from "~icons/lucide/circle"
import Clock from "~icons/lucide/clock"
import Hourglass from "~icons/lucide/hourglass"
import MinusCircle from "~icons/lucide/minus-circle"
import PauseCircle from "~icons/lucide/pause-circle"
import RefreshCw from "~icons/lucide/refresh-cw"
import XCircle from "~icons/lucide/x-circle"

const timeline = [
  {
    id: 1,
    content: "a1b2c3d",
    status: "success",
    date: "Sep 20",
    datetime: "2020-09-20",
    icon: CheckCircle,
    iconColor: "text-green-500",
  },
  {
    id: 2,
    content: "d4e5f6g",
    status: "in progress",
    date: "Sep 22",
    datetime: "2020-09-22",
    icon: RefreshCw,
    iconColor: "text-blue-500",
  },
  {
    id: 3,
    content: "h7i8j9k",
    status: "failure",
    date: "Sep 28",
    datetime: "2020-09-28",
    icon: XCircle,
    iconColor: "text-red-500",
  },
  {
    id: 4,
    content: "l0m1n2o",
    status: "completed",
    date: "Sep 30",
    datetime: "2020-09-30",
    icon: CheckCircle,
    iconColor: "text-green-500",
  },
  {
    id: 5,
    content: "p3q4r5s",
    status: "waiting",
    date: "Oct 4",
    datetime: "2020-10-04",
    icon: Hourglass,
    iconColor: "text-yellow-500",
  },
  {
    id: 6,
    content: "q6r7s8t",
    status: "queued",
    date: "Oct 6",
    datetime: "2020-10-06",
    icon: PauseCircle,
    iconColor: "text-gray-500",
  },
  {
    id: 7,
    content: "u9v0w1x",
    status: "cancelled",
    date: "Oct 10",
    datetime: "2020-10-10",
    icon: Ban,
    iconColor: "text-red-400",
  },
  {
    id: 8,
    content: "y2z3a4b",
    status: "action required",
    date: "Oct 14",
    datetime: "2020-10-14",
    icon: AlertTriangle,
    iconColor: "text-orange-500",
  },
  {
    id: 9,
    content: "c5d6e7f",
    status: "timed out",
    date: "Oct 18",
    datetime: "2020-10-18",
    icon: Clock,
    iconColor: "text-purple-500",
  },
  {
    id: 10,
    content: "g8h9i0j",
    status: "skipped",
    date: "Oct 22",
    datetime: "2020-10-22",
    icon: MinusCircle,
    iconColor: "text-gray-500",
  },
  {
    id: 11,
    content: "k1l2m3n",
    status: "stale",
    date: "Oct 26",
    datetime: "2020-10-26",
    icon: Circle,
    iconColor: "text-gray-400",
  },
  {
    id: 12,
    content: "o4p5q6r",
    status: "neutral",
    date: "Oct 30",
    datetime: "2020-10-30",
    icon: Circle,
    iconColor: "text-gray-300",
  },
]

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

const defaultRange = presets.find((preset) => preset.id === 0)!

const range = ref({
  start: defaultRange.value.start,
  end: defaultRange.value.end,
}) as Ref<DateRange>
</script>

<template>
  <div class="grid">
    <Card class="border-0 shadow-none">
      <CardHeader>
        <CardTitle>
          <span class="truncate"> History </span>
        </CardTitle>
        <Popover>
          <PopoverTrigger as-child>
            <Button variant="link" class="h-auto justify-start gap-2 p-0">
              <!-- <icon-lucide-calendar /> -->
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
      </CardHeader>
      <CardContent>
        <ul role="list" class="-mb-8">
          <li v-for="(event, eventIdx) in timeline" :key="event.id">
            <div class="relative pb-8">
              <span
                v-if="eventIdx !== timeline.length - 1"
                class="bg-border absolute top-2.5 left-2.5 -ml-px h-full w-0.5"
              />
              <div class="relative flex gap-4">
                <div>
                  <span
                    :class="[
                      event.iconColor,
                      'ring-background bg-background flex size-5 items-center justify-center rounded-full ring-6',
                    ]"
                  >
                    <component :is="event.icon" />
                  </span>
                </div>
                <div class="flex min-w-0 flex-1 justify-between space-x-4">
                  <div>
                    <p class="">
                      {{ event.content }}
                      <span class="text-muted-foreground">
                        {{ event.status }}
                      </span>
                    </p>
                  </div>
                  <div
                    class="text-muted-foreground flex items-center text-right text-xs whitespace-nowrap"
                  >
                    <time :datetime="event.datetime">{{ event.date }}</time>
                  </div>
                </div>
              </div>
            </div>
          </li>
        </ul>
      </CardContent>
    </Card>
    <SidebarGroup class="p-6">
      <SidebarGroupContent>
        <Card class="shadow-none">
          <CardHeader>
            <CardTitle> Limit reached </CardTitle>
            <CardDescription class="text-xs">
              Get unlimited access to your activity timeline by upgrading to the
              Pro plan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" class="w-full" size="sm">
              Upgrade
            </Button>
          </CardContent>
        </Card>
      </SidebarGroupContent>
    </SidebarGroup>
  </div>
</template>
