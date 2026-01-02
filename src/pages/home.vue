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
import { DateFormatter, getLocalTimeZone, today } from "@internationalized/date"
import { VisAxis, VisGroupedBar, VisXYContainer } from "@unovis/vue"
import type { DateRange } from "reka-ui"
import Avatar from "vue-boring-avatars"

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

const defaultRange = presets.find((preset) => preset.id === 0)!

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

const chartConfig = {
  desktop: {
    label: "Desktop",
    color: "var(--chart-1)",
  },
  mobile: {
    label: "Mobile",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig

const navMain = [
  {
    title: "Search",
    url: "#",
    icon: IconSearch,
  },
  {
    title: "Ask AI",
    url: "#",
    icon: IconSparkles,
  },
]

const navSecondary = [
  {
    title: "Calendar",
    url: "#",
    icon: IconCalendar,
    badge: false,
  },
  {
    title: "Templates",
    url: "#",
    icon: IconBlocks,
    badge: false,
  },
  {
    title: "Trash",
    url: "#",
    icon: IconTrash2,
    badge: false,
  },
]

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
  { id: 1, title: "Interactions", description: "+265 sales this month." },
  { id: 2, title: "Conversions", description: "+3.2% week over week." },
  { id: 3, title: "Revenue", description: "$12,340 MRR." },
  { id: 4, title: "Agents", description: "+$7,231.89 increase" },
  { id: 5, title: "Performance", description: "+15% conversion rate" },
  { id: 6, title: "Tasks", description: "+15% from last month" },
  { id: 7, title: "Distribution", description: "Category breakdown" },
  { id: 8, title: "Completion", description: "Progress overview" },
  { id: 9, title: "Status", description: "Current state" },
  { id: 10, title: "Active Users", description: "+120 new users today" },
  { id: 11, title: "Bounce Rate", description: "-2.5% improvement" },
  { id: 12, title: "Session Duration", description: "Average 4m 30s" },
]
const expandedCard = ref<number | null>(null)
</script>

<template>
  <Teleport defer to="#left-sidebar">
    <Sidebar collapsible="none" class="w-full">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem v-for="item in navMain" :key="item.title">
            <SidebarMenuButton as-child>
              <a :href="item.url">
                <component :is="item.icon" />
                <span>{{ item.title }}</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <Separator />
      <SidebarContent>
        <OverlayScrollbarsWrapper>
          <SidebarGroup class="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Favorites</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in favorites" :key="item.name">
                <SidebarMenuButton>
                  <Avatar
                    variant="beam"
                    :name="item.name"
                    :colors="[
                      'var(--chart-1)',
                      'var(--chart-2)',
                      'var(--chart-3)',
                      'var(--chart-4)',
                      'var(--chart-5)',
                    ]"
                  />
                  <span>{{ item.name }}</span>
                </SidebarMenuButton>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <SidebarMenuAction
                      show-on-hover
                      class="data-[state=open]:bg-accent"
                    >
                      <IconMoreVertical />
                      <span class="sr-only">More</span>
                    </SidebarMenuAction>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="right">
                    <DropdownMenuItem>
                      <IconStarOff class="text-muted-foreground" />
                      <span>Remove from Favorites</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>
                      <IconLink class="text-muted-foreground" />
                      <span>Copy Link</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <IconArrowUpRight class="text-muted-foreground" />
                      <span>Open in New Tab</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>
                      <IconTrash2 class="text-muted-foreground" />
                      <span>Delete</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton class="text-sidebar-foreground">
                  <IconMoreHorizontal />
                  <span>More</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Teams</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <Collapsible v-for="team in teams" :key="team.name">
                  <SidebarMenuItem>
                    <SidebarMenuButton>
                      <Avatar
                        :name="team.name"
                        :colors="[
                          'var(--chart-1)',
                          'var(--chart-2)',
                          'var(--chart-3)',
                          'var(--chart-4)',
                          'var(--chart-5)',
                        ]"
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
                            <Avatar
                              :name="page.name"
                              :colors="[
                                'var(--chart-1)',
                                'var(--chart-2)',
                                'var(--chart-3)',
                                'var(--chart-4)',
                                'var(--chart-5)',
                              ]"
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
                    <span>More</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </OverlayScrollbarsWrapper>
      </SidebarContent>
      <Separator />
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
  </Teleport>
  <OverlayScrollbarsWrapper>
    <div class="flex grow flex-col overflow-auto overscroll-none scroll-smooth">
      <Tabs default-value="overview" class="gap-0">
        <Teleport defer to="#cta-dock">
          <div class="flex items-center justify-between gap-2">
            <Popover>
              <PopoverTrigger as-child>
                <Button variant="ghost" class="data-[state=open]:bg-accent">
                  <IconCalendar />
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
            <TabsList>
              <TabsTrigger value="overview"> Overview </TabsTrigger>
              <TabsTrigger value="usage"> Usage </TabsTrigger>
            </TabsList>
          </div>
        </Teleport>
        <TabsContent
          value="overview"
          class="grid grid-cols-1 gap-2 p-2 md:grid-cols-2 lg:grid-cols-3"
        >
          <Card
            v-for="card in dashboardData"
            :key="card.id"
            :class="[
              'col-span-1 shadow-none',
              expandedCard === card.id
                ? 'md:col-span-2 lg:col-span-3'
                : 'md:col-span-1 lg:col-span-1',
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
                        {{ expandedCard === card.id ? "Collapse" : "Expand" }}
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
                        <TooltipContent>More options</TooltipContent>

                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>
                            <IconStar />
                            <span>Add to Favorites</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <IconLink />
                            <span>Copy Link</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <IconArrowUpRight />
                            <span>Open in New Tab</span>
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
                        new Date(d).toLocaleDateString('en-US', {
                          month: 'short',
                        })
                    "
                    :tick-values="chartData.map((d) => d.date)"
                  />
                  <ChartTooltip />
                  <ChartCrosshair
                    :template="
                      componentToString(chartConfig, ChartTooltipContent, {
                        labelFormatter(d) {
                          return new Date(d).toLocaleDateString('en-US', {
                            month: 'long',
                          })
                        },
                      })
                    "
                    :color="[
                      chartConfig.desktop.color,
                      chartConfig.mobile.color,
                    ]"
                    bar-padding="0.1"
                    group-padding="0"
                  />
                </VisXYContainer>
                <ChartLegendContent />
              </ChartContainer>
            </CardContent>
            <!-- <Separator /> -->
            <!-- <CardFooter>
              <CardDescription>{{ card.description }}</CardDescription>
              <Button variant="outline" size="sm">
                <IconRocket /> Ask AI
              </Button>
              <Button variant="outline" size="icon-sm">
                <IconArrowUpRight />
              </Button>
            </CardFooter> -->
          </Card>
        </TabsContent>
        <TabsContent value="usage"> </TabsContent>
      </Tabs>
    </div>
  </OverlayScrollbarsWrapper>
  <Teleport defer to="#right-sidebar">
    <Sidebar collapsible="none" class="w-full">
      <SidebarContent>
        <OverlayScrollbarsWrapper>
          <SidebarGroup>
            <SidebarGroupLabel>Table of Contents</SidebarGroupLabel>
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
        </OverlayScrollbarsWrapper>
      </SidebarContent>
    </Sidebar>
  </Teleport>
</template>
