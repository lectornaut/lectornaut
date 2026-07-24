<script lang="ts" setup>
import type { ChartConfig } from "@/components/ui/chart"
import {
  ChartContainer,
  ChartCrosshair,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  componentToString,
} from "@/components/ui/chart"
import {
  IconArrowUpRight,
  IconBlocks,
  IconCalendar,
  IconChevronRight,
  IconLink,
  IconMaximize,
  IconMinimize,
  IconMoreHorizontal,
  IconMoreVertical,
  IconPlus,
  IconSearch,
  IconSparkles,
  IconStar,
  IconStarOff,
  IconTrash2,
} from "@/data/icons"
import { getLocalTimeZone, today } from "@internationalized/date"
import { VisAxis, VisGroupedBar, VisXYContainer } from "@unovis/vue"
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

const { t } = useI18n()

const presets = computed(() => [
  {
    id: 0,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 0,
      }),
      end: today(getLocalTimeZone()),
    },
    label: t("pages.home.presets.today"),
  },
  {
    id: 7,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 7,
      }),
      end: today(getLocalTimeZone()),
    },
    label: t("pages.home.presets.last7days"),
  },
  {
    id: 14,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 14,
      }),
      end: today(getLocalTimeZone()),
    },
    label: t("pages.home.presets.last14days"),
  },
  {
    id: 30,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 30,
      }),
      end: today(getLocalTimeZone()),
    },
    label: t("pages.home.presets.last30days"),
  },
  {
    id: 90,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 90,
      }),
      end: today(getLocalTimeZone()),
    },
    label: t("pages.home.presets.last3months"),
  },
  {
    id: 180,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 180,
      }),
      end: today(getLocalTimeZone()),
    },
    label: t("pages.home.presets.last6months"),
  },
  {
    id: 365,
    value: {
      start: today(getLocalTimeZone()).subtract({
        days: 365,
      }),
      end: today(getLocalTimeZone()),
    },
    label: t("pages.home.presets.last1year"),
  },
])

const defaultRange = presets.value.find((preset) => preset.id === 0)!

const range = ref({
  start: defaultRange.value.start,
  end: defaultRange.value.end,
}) as Ref<DateRange>

const chartData = [
  { date: new Date("2024-01-01"), desktop: 186, mobile: 80 },
  { date: new Date("2024-02-01"), desktop: 305, mobile: 200 },
  { date: new Date("2024-03-01"), desktop: 237, mobile: 120 },
  { date: new Date("2024-04-01"), desktop: 73, mobile: 190 },
  { date: new Date("2024-05-01"), desktop: 209, mobile: 130 },
  { date: new Date("2024-06-01"), desktop: 214, mobile: 140 },
]

type Data = (typeof chartData)[number]

const chartMonthLabels = new Map(
  chartData.map((item) => [
    item.date.getTime(),
    useDateFormat(item.date, "MMM").value,
  ])
)
const chartMonthLongLabels = new Map(
  chartData.map((item) => [
    item.date.getTime(),
    useDateFormat(item.date, "MMMM").value,
  ])
)

const formatDate = (
  value: Date | string | number | null | undefined,
  format = "MMM D, YYYY"
) => {
  if (value == null) return "—"
  return useDateFormat(value, format).value
}

const chartConfig = computed(
  () =>
    ({
      desktop: {
        label: t("pages.home.chart.desktop"),
        color: "var(--color-chart-1)",
      },
      mobile: {
        label: t("pages.home.chart.mobile"),
        color: "var(--color-chart-3)",
      },
    }) satisfies ChartConfig
)

const navMain = computed(() => [
  {
    title: t("pages.home.navMain.search"),
    url: "#",
    icon: IconSearch,
  },
  {
    title: t("pages.home.navMain.askAi"),
    url: "#",
    icon: IconSparkles,
  },
])

const navSecondary = computed(() => [
  {
    title: t("pages.home.navSecondary.calendar"),
    url: "#",
    icon: IconCalendar,
    badge: false,
  },
  {
    title: t("pages.home.navSecondary.templates"),
    url: "#",
    icon: IconBlocks,
    badge: false,
  },
  {
    title: t("pages.home.navSecondary.trash"),
    url: "#",
    icon: IconTrash2,
    badge: false,
  },
])

const favorites = [
  {
    name: "Project Management & Task Tracking",
    url: "#",
  },
  {
    name: "Family Recipe Collection & Meal Planning",
    url: "#",
  },
  {
    name: "Fitness Tracker & Workout Routines",
    url: "#",
  },
  {
    name: "Book Notes & Reading List",
    url: "#",
  },
  {
    name: "Sustainable Gardening Tips & Plant Care",
    url: "#",
  },
  {
    name: "Language Learning Progress & Resources",
    url: "#",
  },
  {
    name: "Home Renovation Ideas & Budget Tracker",
    url: "#",
  },
  {
    name: "Personal Finance & Investment Portfolio",
    url: "#",
  },
  {
    name: "Movie & TV Show Watchlist with Reviews",
    url: "#",
  },
  {
    name: "Daily Habit Tracker & Goal Setting",
    url: "#",
  },
]

const teams = [
  {
    name: "Personal Life Management",
    pages: [
      {
        name: "Daily Journal & Reflection",
        url: "#",
      },
      {
        name: "Health & Wellness Tracker",
        url: "#",
      },
      {
        name: "Personal Growth & Learning Goals",
        url: "#",
      },
    ],
  },
  {
    name: "Professional Development",
    pages: [
      {
        name: "Career Objectives & Milestones",
        url: "#",
      },
      {
        name: "Skill Acquisition & Training Log",
        url: "#",
      },
      {
        name: "Networking Contacts & Events",
        url: "#",
      },
    ],
  },
  {
    name: "Creative Projects",
    pages: [
      {
        name: "Writing Ideas & Story Outlines",
        url: "#",
      },
      {
        name: "Art & Design Portfolio",
        url: "#",
      },
      {
        name: "Music Composition & Practice Log",
        url: "#",
      },
    ],
  },
  {
    name: "Home Management",
    pages: [
      {
        name: "Household Budget & Expense Tracking",
        url: "#",
      },
      {
        name: "Home Maintenance Schedule & Tasks",
        url: "#",
      },
      {
        name: "Family CalendarIcon & Event Planning",
        url: "#",
      },
    ],
  },
  {
    name: "Travel & Adventure",
    pages: [
      {
        name: "Trip Planning & Itineraries",
        url: "#",
      },
      {
        name: "Travel Bucket List & Inspiration",
        url: "#",
      },
      {
        name: "Travel Journal & Photo Gallery",
        url: "#",
      },
    ],
  },
]

const navToc = [
  {
    title: "Getting Started",
    url: "#",
    items: [
      {
        title: "Installation",
        url: "#",
      },
      {
        title: "Project Structure",
        url: "#",
      },
    ],
  },
  {
    title: "Building Your Application",
    url: "#",
    items: [
      {
        title: "Routing",
        url: "#",
      },
      {
        title: "Data Fetching",
        url: "#",
        isActive: true,
      },
      {
        title: "Rendering",
        url: "#",
      },
      {
        title: "Caching",
        url: "#",
      },
      {
        title: "Styling",
        url: "#",
      },
      {
        title: "Optimizing",
        url: "#",
      },
      {
        title: "Configuring",
        url: "#",
      },
      {
        title: "Testing",
        url: "#",
      },
      {
        title: "Authentication",
        url: "#",
      },
      {
        title: "Deploying",
        url: "#",
      },
      {
        title: "Upgrading",
        url: "#",
      },
      {
        title: "Examples",
        url: "#",
      },
    ],
  },
  {
    title: "API Reference",
    url: "#",
    items: [
      {
        title: "Components",
        url: "#",
      },
      {
        title: "File Conventions",
        url: "#",
      },
      {
        title: "Functions",
        url: "#",
      },
      {
        title: "next.config.js Options",
        url: "#",
      },
      {
        title: "CLI",
        url: "#",
      },
      {
        title: "Edge Runtime",
        url: "#",
      },
    ],
  },
  {
    title: "Architecture",
    url: "#",
    items: [
      {
        title: "Accessibility",
        url: "#",
      },
      {
        title: "Fast Refresh",
        url: "#",
      },
      {
        title: "Next.js Compiler",
        url: "#",
      },
      {
        title: "Supported Browsers",
        url: "#",
      },
      {
        title: "Turbopack",
        url: "#",
      },
    ],
  },
  {
    title: "Community",
    url: "#",
    items: [
      {
        title: "Contribution Guide",
        url: "#",
      },
    ],
  },
]

const dashboardData = [
  {
    title: "Engagement",
    description: "User activity and interaction metrics",
    cards: [
      { id: 1, title: "Active Users", description: "+120 new users today" },
      { id: 2, title: "Sessions", description: "12,486 total sessions" },
      { id: 3, title: "Page Views", description: "+18% from last week" },
      { id: 4, title: "Bounce Rate", description: "-2.5% improvement" },
      { id: 5, title: "Session Duration", description: "Average 4m 30s" },
      { id: 6, title: "Interactions", description: "+265 actions this month" },
      { id: 7, title: "Retention", description: "82% returning users" },
      { id: 8, title: "Engagement Score", description: "7.4 out of 10" },
    ],
  },
  {
    title: "Revenue",
    description: "Financial performance and growth",
    cards: [
      { id: 9, title: "MRR", description: "$12,340 monthly recurring" },
      { id: 10, title: "ARR", description: "$148,080 annualized" },
      { id: 11, title: "Conversions", description: "+3.2% week over week" },
      { id: 12, title: "ARPU", description: "$24.50 per user" },
      { id: 13, title: "Churn Rate", description: "-1.2% this quarter" },
      { id: 14, title: "LTV", description: "$580 avg. lifetime value" },
      { id: 15, title: "Net Revenue", description: "+$7,231.89 increase" },
      { id: 16, title: "Transactions", description: "1,842 this month" },
    ],
  },
  {
    title: "Operations",
    description: "System health and task progress",
    cards: [
      { id: 17, title: "Tasks", description: "+15% completed this month" },
      { id: 18, title: "Agents", description: "24 active agents" },
      { id: 19, title: "Uptime", description: "99.98% availability" },
      { id: 20, title: "Response Time", description: "142ms average" },
      { id: 21, title: "Error Rate", description: "0.03% of requests" },
      { id: 22, title: "Deployments", description: "12 releases this week" },
      { id: 23, title: "Completion", description: "87% tasks on track" },
      { id: 24, title: "Performance", description: "+15% throughput gain" },
    ],
  },
]
const expandedCard = ref<number | null>(null)
</script>

<template>
  <SidebarSlot side="left">
    <Sidebar collapsible="none" class="w-full">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem v-for="item in navMain" :key="item.title">
            <SidebarMenuButton as-child>
              <a :href="item.url">
                <Component :is="item.icon" />
                <span>{{ item.title }}</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <ScrollContainer>
          <SidebarGroup class="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>{{
              t("pages.home.sidebar.favorites")
            }}</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in favorites" :key="item.name">
                <SidebarMenuButton>
                  <AppAvatar variant="beam" :name="item.name" class="size-10" />
                  <span>{{ item.name }}</span>
                </SidebarMenuButton>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <SidebarMenuAction
                      show-on-hover
                      class="data-[state=open]:bg-accent"
                    >
                      <IconMoreVertical />
                      <span class="sr-only">{{ t("actions.more") }}</span>
                    </SidebarMenuAction>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem>
                      <IconStarOff class="text-muted-foreground" />
                      <span>{{
                        t("pages.home.dropdown.removeFromFavorites")
                      }}</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>
                      <IconLink class="text-muted-foreground" />
                      <span>{{ t("actions.copyURL") }}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <IconArrowUpRight class="text-muted-foreground" />
                      <span>{{ t("actions.openInNewTab") }}</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>
                      <IconTrash2 class="text-muted-foreground" />
                      <span>{{ t("actions.delete") }}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton class="text-sidebar-foreground">
                  <IconMoreHorizontal />
                  <span>{{ t("actions.more") }}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>{{
              t("pages.home.sidebar.teams")
            }}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <Collapsible v-for="team in teams" :key="team.name">
                  <SidebarMenuItem>
                    <SidebarMenuButton>
                      <AppAvatar
                        variant="marble"
                        :name="team.name"
                        class="size-10"
                      />
                      <span>{{ team.name }}</span>
                    </SidebarMenuButton>
                    <CollapsibleTrigger as-child>
                      <SidebarMenuAction
                        class="bg-sidebar-accent text-sidebar-accent-foreground left-1.5 data-[state=open]:rotate-90"
                        show-on-hover
                      >
                        <IconChevronRight />
                      </SidebarMenuAction>
                    </CollapsibleTrigger>
                    <SidebarMenuAction show-on-hover>
                      <IconPlus />
                    </SidebarMenuAction>
                    <CollapsibleContent>
                      <SidebarMenuSub class="mr-0 pr-0">
                        <SidebarMenuSubItem
                          v-for="page in team.pages"
                          :key="page.name"
                        >
                          <SidebarMenuSubButton>
                            <AppAvatar
                              variant="marble"
                              :name="page.name"
                              class="size-10"
                            />
                            <span>{{ page.name }}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
                <SidebarMenuItem>
                  <SidebarMenuButton class="text-sidebar-foreground">
                    <IconMoreHorizontal />
                    <span>{{ t("actions.more") }}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </ScrollContainer>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem v-for="item in navSecondary" :key="item.title">
            <SidebarMenuButton>
              <Component :is="item.icon" />
              <span>{{ item.title }}</span>
            </SidebarMenuButton>
            <SidebarMenuBadge v-if="item.badge">
              <Component :is="item.badge" />
            </SidebarMenuBadge>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  </SidebarSlot>
  <Tabs default-value="overview" class="gap-0">
    <Teleport defer to="#cta-dock">
      <div class="flex grow items-center justify-between gap-2">
        <Popover>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <PopoverTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    class="data-[state=open]:bg-accent"
                  >
                    <IconCalendar />
                  </Button>
                </PopoverTrigger>
                <PopoverContent>
                  <Select v-model="range">
                    <Button
                      variant="outline"
                      class="w-full justify-between"
                      as-child
                    >
                      <SelectTrigger>
                        <SelectValue :placeholder="t('common.select')" />
                      </SelectTrigger>
                    </Button>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem
                          v-for="preset in presets"
                          :key="preset.id"
                          :value="preset.value"
                        >
                          {{ preset.label }}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <RangeCalendar
                    v-model="range"
                    :max-value="today(getLocalTimeZone())"
                    initial-focus
                    class="p-2"
                  />
                </PopoverContent>
              </TooltipTrigger>
              <TooltipContent>
                {{
                  range.start
                    ? formatDate(
                        range.start.toDate(getLocalTimeZone()),
                        "MMM D, YYYY"
                      )
                    : "Start date"
                }}
                -
                {{
                  range.end
                    ? formatDate(
                        range.end.toDate(getLocalTimeZone()),
                        "MMM D, YYYY"
                      )
                    : "End date"
                }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Popover>
        <TabsList>
          <TabsTrigger value="overview">
            {{ t("pages.home.tabs.overview") }}
          </TabsTrigger>
          <TabsTrigger value="usage">
            {{ t("pages.home.tabs.usage") }}
          </TabsTrigger>
        </TabsList>
      </div>
    </Teleport>
    <TabsContent value="overview" class="@container">
      <div class="grid gap-8">
        <div
          v-for="group in dashboardData"
          :key="group.title"
          class="flex flex-col gap-4"
        >
          <!-- <div class="flex flex-col gap-1 p-2">
            <h2
              class="text-secondary-foreground text-base leading-tight font-semibold tracking-tight"
            >
              {{ group.title }}
            </h2>
            <p >{{ group.description }}</p>
          </div> -->
          <div
            class="container mx-auto grid max-w-4xl grid-cols-1 gap-2 p-2 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4"
          >
            <Card
              v-for="card in group.cards"
              :key="card.id"
              :class="[
                'col-span-1 shadow-none',
                {
                  '@xl:col-span-2 @6xl:col-span-2': expandedCard === card.id,
                },
              ]"
            >
              <CardHeader class="relative">
                <CardTitle>{{ card.title }}</CardTitle>
                <CardDescription>{{ card.description }}</CardDescription>
                <div class="absolute top-0 right-6 flex gap-2">
                  <ButtonGroup>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <Button
                            variant="outline"
                            size="icon-sm"
                            @click="
                              expandedCard =
                                expandedCard === card.id ? null : card.id
                            "
                          >
                            <Component
                              :is="
                                expandedCard === card.id
                                  ? IconMinimize
                                  : IconMaximize
                              "
                            />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {{
                            expandedCard === card.id
                              ? t("actions.collapse")
                              : t("actions.expand")
                          }}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <DropdownMenu>
                          <TooltipTrigger as-child>
                            <DropdownMenuTrigger as-child>
                              <Button
                                variant="outline"
                                size="icon-sm"
                                class="data-[state=open]:bg-accent"
                              >
                                <IconMoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                          </TooltipTrigger>
                          <TooltipContent>{{
                            t("actions.moreOptions")
                          }}</TooltipContent>

                          <DropdownMenuContent>
                            <DropdownMenuItem>
                              <IconStar />
                              <span>{{
                                t("pages.home.dropdown.addToFavorites")
                              }}</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <IconLink />
                              <span>{{ t("actions.copyURL") }}</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <IconArrowUpRight />
                              <span>{{ t("actions.openInNewTab") }}</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </Tooltip>
                    </TooltipProvider>
                  </ButtonGroup>
                </div>
              </CardHeader>
              <CardContent>
                <ChartContainer :config="chartConfig" class="h-46 w-full">
                  <VisXYContainer :data="chartData">
                    <VisGroupedBar
                      :x="(d: Data) => d.date"
                      :y="[(d: Data) => d.desktop, (d: Data) => d.mobile]"
                      :color="[
                        chartConfig.desktop.color,
                        chartConfig.mobile.color,
                      ]"
                      bar-padding="0.1"
                      group-padding="0.25"
                    />
                    <VisAxis
                      type="x"
                      :x="(d: Data) => d.date"
                      :tick-line="false"
                      :domain-line="false"
                      :grid-line="false"
                      :tick-format="
                        (d: number) =>
                          chartMonthLabels.get(new Date(d).getTime()) ?? ''
                      "
                      :tick-values="chartData.map((d) => d.date)"
                    />
                    <ChartTooltip />
                    <ChartCrosshair
                      :template="
                        componentToString(chartConfig, ChartTooltipContent, {
                          labelFormatter(d) {
                            return (
                              chartMonthLongLabels.get(new Date(d).getTime()) ??
                              ''
                            )
                          },
                        })
                      "
                      :color="[
                        chartConfig.desktop.color,
                        chartConfig.mobile.color,
                      ]"
                    />
                  </VisXYContainer>
                  <ChartLegendContent />
                </ChartContainer>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </TabsContent>
    <TabsContent value="usage"> </TabsContent>
  </Tabs>
  <SidebarSlot side="right">
    <Sidebar collapsible="none" class="w-full">
      <SidebarContent>
        <ScrollContainer>
          <SidebarGroup>
            <SidebarGroupLabel>{{
              t("pages.home.sidebar.tableOfContents")
            }}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem v-for="item in navToc" :key="item.title">
                  <SidebarMenuButton>
                    {{ item.title }}
                  </SidebarMenuButton>
                  <SidebarMenuSub v-if="item.items.length" class="mr-0 pr-0">
                    <SidebarMenuSubItem
                      v-for="subItem in item.items"
                      :key="subItem.title"
                    >
                      <SidebarMenuSubButton :is-active="subItem.isActive">
                        {{ subItem.title }}
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </ScrollContainer>
      </SidebarContent>
    </Sidebar>
  </SidebarSlot>
</template>
