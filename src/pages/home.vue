<script lang="ts" setup>
import { monthlyActivity } from "@/data/chart"
import { DateFormatter, getLocalTimeZone, today } from "@internationalized/date"
import type { DateRange } from "reka-ui"
import Avatar from "vue-boring-avatars"
import Blocks from "~icons/lucide/blocks"
import Calendar from "~icons/lucide/calendar"
import Search from "~icons/lucide/search"
import Sparkles from "~icons/lucide/sparkles"
import Trash2 from "~icons/lucide/trash-2"

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

const navMain = [
  {
    title: "Search",
    url: "#",
    icon: Search,
  },
  {
    title: "Ask AI",
    url: "#",
    icon: Sparkles,
  },
]

const navSecondary = [
  {
    title: "Calendar",
    url: "#",
    icon: Calendar,
    badge: false,
  },
  {
    title: "Templates",
    url: "#",
    icon: Blocks,
    badge: false,
  },
  {
    title: "Trash",
    url: "#",
    icon: Trash2,
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
        name: "Family Calendar & Event Planning",
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
</script>

<template>
  <Teleport defer to="#left-sidebar">
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
      <Separator />
      <SidebarContent>
        <OverlayScrollbarsWrapper>
          <SidebarGroup class="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Favorites</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in favorites" :key="item.name">
                <SidebarMenuButton>
                  <Avatar
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
                    <SidebarMenuAction show-on-hover>
                      <icon-lucide-more-vertical />
                      <span class="sr-only">More</span>
                    </SidebarMenuAction>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    class="w-56 rounded-lg"
                    align="start"
                    side="right"
                  >
                    <DropdownMenuItem>
                      <icon-lucide-star-off class="text-muted-foreground" />
                      <span>Remove from Favorites</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>
                      <icon-lucide-link class="text-muted-foreground" />
                      <span>Copy Link</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <icon-lucide-arrow-up-right
                        class="text-muted-foreground"
                      />
                      <span>Open in New Tab</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>
                      <icon-lucide-trash-2 class="text-muted-foreground" />
                      <span>Delete</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton class="text-sidebar-foreground">
                  <icon-lucide-more-horizontal />
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
                        <icon-lucide-chevron-right />
                      </SidebarMenuAction>
                    </CollapsibleTrigger>
                    <SidebarMenuAction show-on-hover>
                      <icon-lucide-plus />
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
                    <icon-lucide-more-horizontal />
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
                <Button variant="ghost">
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
          class="grid grid-cols-1 gap-2 p-2 md:grid-cols-2 lg:grid-cols-12"
        >
          <Card
            v-for="card in [
              { title: 'Interactions', description: '+265 sales this month.' },
              { title: 'Conversions', description: '+3.2% week over week.' },
              { title: 'Revenue', description: '$12,340 MRR.' },
            ]"
            :key="card.title"
            class="col-span-1 shadow-none md:col-span-2 lg:col-span-4"
          >
            <CardHeader>
              <CardTitle>{{ card.title }}</CardTitle>
              <CardDescription>{{ card.description }}</CardDescription>
            </CardHeader>
            <CardContent class="-px-4 -mb-6 overflow-clip">
              <AreaChart
                class="-mx-6 h-40 w-full min-w-[-webkit-fill-available]"
                :data="monthlyActivity"
                :categories="['total']"
                index="name"
                :colors="[
                  'var(--chart-2)',
                  'var(--chart-4)',
                  'var(--chart-1)',
                  'var(--chart-5)',
                  'var(--chart-3)',
                ]"
                :show-gradient="true"
                :show-tooltip="false"
                :show-legend="false"
                :show-grid-line="false"
                :show-x-axis="false"
                :show-y-axis="false"
              />
            </CardContent>
            <!-- <Separator /> -->
            <!-- <CardFooter>
              <CardDescription>{{ card.description }}</CardDescription>
              <Button variant="outline" size="sm">
                <icon-lucide-sparkles /> Ask AI
              </Button>
              <Button variant="outline" size="icon-sm">
                <icon-lucide-arrow-up-right />
              </Button>
            </CardFooter> -->
          </Card>
          <Card
            v-for="card in [
              { title: 'Interactions', description: '+265 sales this month.' },
              { title: 'Conversions', description: '+3.2% week over week.' },
              { title: 'Revenue', description: '$12,340 MRR.' },
            ]"
            :key="card.title"
            class="col-span-1 shadow-none md:col-span-2 lg:col-span-4"
          >
            <CardHeader>
              <CardTitle>{{ card.title }}</CardTitle>
              <CardDescription>{{ card.description }}</CardDescription>
            </CardHeader>
            <CardContent class="-mb-6 overflow-clip">
              <BarChart
                class="h-40 w-full min-w-[-webkit-fill-available]"
                :data="monthlyActivity"
                :categories="['total', 'predicted']"
                index="total"
                :colors="[
                  'var(--chart-2)',
                  'var(--chart-4)',
                  'var(--chart-1)',
                  'var(--chart-5)',
                  'var(--chart-3)',
                ]"
                :type="'stacked'"
                :rounded-corners="8"
                :show-tooltip="false"
                :show-legend="false"
                :show-grid-line="false"
                :show-x-axis="false"
                :show-y-axis="false"
              />
            </CardContent>
            <!-- <Separator /> -->
            <!-- <CardFooter>
              <CardDescription>{{ card.description }}</CardDescription>
              <Button variant="outline" size="sm">
                <icon-lucide-sparkles /> Ask AI
              </Button>
              <Button variant="outline" size="icon-sm">
                <icon-lucide-arrow-up-right />
              </Button>
            </CardFooter> -->
          </Card>
          <Card
            v-for="card in [
              { title: 'Agents', description: '+$7,231.89 increase' },
              { title: 'Performance', description: '+15% conversion rate' },
              { title: 'Tasks', description: '+15% from last month' },
            ]"
            :key="card.title"
            class="col-span-1 shadow-none md:col-span-2 lg:col-span-4"
          >
            <CardHeader>
              <CardTitle>{{ card.title }}</CardTitle>
              <CardDescription>{{ card.description }}</CardDescription>
            </CardHeader>
            <CardContent class="-px-4 -mb-6 overflow-clip pb-4">
              <LineChart
                class="-mx-6 h-32 w-full min-w-[-webkit-fill-available]"
                :data="monthlyActivity"
                :categories="['total']"
                index="name"
                :colors="[
                  'var(--chart-2)',
                  'var(--chart-4)',
                  'var(--chart-1)',
                  'var(--chart-5)',
                  'var(--chart-3)',
                ]"
                :show-tooltip="false"
                :show-legend="false"
                :show-grid-line="false"
                :show-x-axis="false"
                :show-y-axis="false"
              />
            </CardContent>
            <!-- <Separator /> -->
            <!-- <CardFooter>
              <CardDescription>{{ card.description }}</CardDescription>
              <Button variant="outline" size="sm">
                <icon-lucide-sparkles /> Ask AI
              </Button>
              <Button variant="outline" size="icon-sm">
                <icon-lucide-arrow-up-right />
              </Button>
            </CardFooter> -->
          </Card>
          <Card
            v-for="card in [
              { title: 'Distribution', description: 'Category breakdown' },
              { title: 'Completion', description: 'Progress overview' },
              { title: 'Status', description: 'Current state' },
            ]"
            :key="card.title"
            class="col-span-1 shadow-none md:col-span-2 lg:col-span-4"
          >
            <CardHeader>
              <CardTitle>{{ card.title }}</CardTitle>
              <CardDescription>{{ card.description }}</CardDescription>
            </CardHeader>
            <CardContent class="-px-4 -mb-6 overflow-clip pb-4">
              <DonutChart
                class="-mx-6 h-32 w-full min-w-[-webkit-fill-available]"
                :category="'total'"
                :data="monthlyActivity"
                index="name"
                :colors="[
                  'var(--chart-1)',
                  'var(--chart-2)',
                  'var(--chart-3)',
                  'var(--chart-4)',
                  'var(--chart-5)',
                ]"
                :type="'pie'"
                :show-tooltip="false"
                :show-legend="false"
              />
            </CardContent>
            <!-- <Separator /> -->
            <!-- <CardFooter>
              <CardDescription>{{ card.description }}</CardDescription>
              <Button variant="outline" size="sm">
                <icon-lucide-sparkles /> Ask AI
              </Button>
              <Button variant="outline" size="icon-sm">
                <icon-lucide-arrow-up-right />
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
