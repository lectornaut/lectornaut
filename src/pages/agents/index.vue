<script lang="ts" setup>
import {
  IconBriefcase,
  IconCalculator,
  IconCalendar,
  IconCircleFilled,
  IconClock,
  IconHash,
  IconListFilter,
  IconPlus,
  IconSearch,
  IconSmile,
  IconStar,
  IconUserRoundPlus,
} from "@/data/icons"
import Avatar from "vue-boring-avatars"

definePage({
  meta: {
    requiresUser: true,
    layout: false,
    sidebar: "Agents",
    breadcrumb: "Agents",
  },
})

useHead({
  title: "Agents",
})

const categories = [
  { id: "featured", label: "Featured" },
  { id: "writing", label: "Writing" },
  { id: "productivity", label: "Productivity" },
  { id: "design", label: "Design" },
  { id: "development", label: "Development" },
  { id: "analysis", label: "Analysis" },
  { id: "automation", label: "Automation" },
  { id: "education", label: "Education" },
  { id: "communication", label: "Communication" },
  { id: "entertainment", label: "Entertainment" },
  { id: "finance", label: "Finance" },
  { id: "health", label: "Health" },
  { id: "travel", label: "Travel" },
  { id: "shopping", label: "Shopping" },
  { id: "social", label: "Social" },
  { id: "gaming", label: "Gaming" },
  { id: "news", label: "News" },
  { id: "music", label: "Music" },
  { id: "food", label: "Food" },
  { id: "sports", label: "Sports" },
  { id: "lifestyle", label: "Lifestyle" },
  { id: "other", label: "Other" },
]

const agents = [
  {
    name: "William Smith",
    url: "/agents",
    email: "williamsmith@example.com",
    subject: "Meeting Tomorrow",
    date: "09:34 AM",
    teaser:
      "Hi team, just a reminder about our meeting tomorrow at 10 AM.\nPlease come prepared with your project updates.",
  },
  {
    name: "Alice Smith",
    url: "/agents",
    email: "alicesmith@example.com",
    subject: "Re: Project Update",
    date: "Yesterday",
    teaser:
      "Thanks for the update. The progress looks great so far.\nLet's schedule a call to discuss the next steps.",
  },
  {
    name: "Bob Johnson",
    url: "/agents",
    email: "bobjohnson@example.com",
    subject: "Weekend Plans",
    date: "2 days ago",
    teaser:
      "Hey everyone! I'm thinking of organizing a team outing this weekend.\nWould you be interested in a hiking trip or a beach day?",
  },
  {
    name: "Emily Davis",
    url: "/agents",
    email: "emilydavis@example.com",
    subject: "Re: Question about Budget",
    date: "2 days ago",
    teaser:
      "I've reviewed the budget numbers you sent over.\nCan we set up a quick call to discuss some potential adjustments?",
  },
  {
    name: "Michael Wilson",
    url: "/agents",
    email: "michaelwilson@example.com",
    subject: "Important Announcement",
    date: "1 week ago",
    teaser:
      "Please join us for an all-hands meeting this Friday at 3 PM.\nWe have some exciting news to share about the company's future.",
  },
  {
    name: "Sarah Brown",
    url: "/agents",
    email: "sarahbrown@example.com",
    subject: "Re: Feedback on Proposal",
    date: "1 week ago",
    teaser:
      "Thank you for sending over the proposal. I've reviewed it and have some thoughts.\nCould we schedule a meeting to discuss my feedback in detail?",
  },
  {
    name: "David Lee",
    url: "/agents",
    email: "davidlee@example.com",
    subject: "New Project Idea",
    date: "1 week ago",
    teaser:
      "I've been brainstorming and came up with an interesting project concept.\nDo you have time this week to discuss its potential impact and feasibility?",
  },
  {
    name: "Olivia Wilson",
    url: "/agents",
    email: "oliviawilson@example.com",
    subject: "Vacation Plans",
    date: "1 week ago",
    teaser:
      "Just a heads up that I'll be taking a two-week vacation next month.\nI'll make sure all my projects are up to date before I leave.",
  },
  {
    name: "James Martin",
    url: "/agents",
    email: "jamesmartin@example.com",
    subject: "Re: Conference Registration",
    date: "1 week ago",
    teaser:
      "I've completed the registration for the upcoming tech conference.\nLet me know if you need any additional information from my end.",
  },
  {
    name: "Sophia White",
    url: "/agents",
    email: "sophiawhite@example.com",
    subject: "Team Dinner",
    date: "1 week ago",
    teaser:
      "To celebrate our recent project success, I'd like to organize a team dinner.\nAre you available next Friday evening? Please let me know your preferences.",
  },
]

const getStatus = () => {
  const rand = Math.random()
  if (rand > 0.75)
    return { text: "LIVE", class: "bg-green-500/10 text-green-500" }
  if (rand > 0.5)
    return { text: "PAUSED", class: "bg-amber-500/10 text-amber-500" }
  if (rand > 0.25)
    return { text: "RUNNING", class: "bg-sky-500/10 text-sky-500" }
  return { text: "FAILING", class: "bg-red-500/10 text-red-500" }
}

const route = useRoute()
</script>

<template>
  <Teleport defer to="#left-sidebar">
    <Tabs default-value="details" class="grow gap-0">
      <Sidebar collapsible="none" class="w-full">
        <SidebarHeader>
          <div class="flex items-center justify-between gap-2">
            <span class="text-foreground ml-2 text-base font-medium">
              {{ route.meta.sidebar }}
            </span>
            <Button variant="ghost">
              <IconPlus />
              <span>{{ $t("pages.agents.buttons.new") }}</span>
            </Button>
          </div>
        </SidebarHeader>
        <Separator />
        <SidebarHeader>
          <div class="flex items-center justify-between gap-2">
            <div
              class="relative flex h-full grow items-center justify-between gap-2"
            >
              <span
                class="pointer-events-none absolute inset-y-0 inset-s-0 flex items-center justify-center px-3"
              >
                <IconSearch />
              </span>
              <SidebarInput
                class="pl-9"
                :placeholder="$t('pages.agents.search')"
              />
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button variant="ghost" size="icon">
                    <IconListFilter />
                  </Button>
                </TooltipTrigger>
                <TooltipContent> {{ $t("actions.filter") }} </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </SidebarHeader>
        <Separator />
        <SidebarContent>
          <OverlayScrollbarsWrapper>
            <SidebarGroup>
              <SidebarGroupContent class="flex flex-col gap-2">
                <RouterLink
                  v-for="(workflow, index) in agents"
                  :key="workflow.email"
                  :to="`${workflow.url}/${index}`"
                  class="ring-offset-background focus-visible:ring-ring/50 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  <Card class="shadow-none">
                    <CardHeader>
                      <CardTitle class="flex w-full justify-between">
                        <span>{{ workflow.name }}</span>
                      </CardTitle>
                      <CardDescription class="line-clamp-1">
                        {{ workflow.subject }}
                      </CardDescription>
                    </CardHeader>
                    <CardContent class="flex flex-col gap-1">
                      <Badge variant="secondary" :class="getStatus().class">
                        <IconCircleFilled />
                        <span>
                          {{ getStatus().text }}
                        </span>
                      </Badge>
                      <Badge variant="secondary">
                        <IconHash />
                        <span> {{ Math.floor(Math.random() * 60) }} RUNS </span>
                      </Badge>
                      <Badge variant="secondary">
                        <IconClock />
                        <span>
                          {{ Math.floor(Math.random() * 60) }} HOURS
                        </span>
                      </Badge>
                    </CardContent>
                  </Card>
                </RouterLink>
              </SidebarGroupContent>
            </SidebarGroup>
          </OverlayScrollbarsWrapper>
        </SidebarContent>
      </Sidebar>
    </Tabs>
  </Teleport>
  <OverlayScrollbarsWrapper>
    <div class="mx-auto grid w-fit grid-cols-1">
      <div class="flex max-w-6xl flex-col gap-16 p-16">
        <div class="mx-auto grid max-w-lg gap-8">
          <h1 class="text-center text-5xl font-semibold tracking-tight">
            {{ $t("pages.agents.title") }}
          </h1>
          {{ $t("pages.agents.description") }}
          <Command class="bg-card border">
            <CommandInput
              :placeholder="$t('pages.agents.searchPlaceholder')"
              class="border-none focus:border-inherit focus:ring-0"
            />
            <CommandList>
              <CommandEmpty>{{ $t("pages.agents.empty") }}</CommandEmpty>
              <CommandGroup :heading="$t('pages.agents.trending')">
                <CommandItem value="calendar" class="py-2">
                  <IconCalendar />
                  <span>{{ $t("pages.agents.categories.calendar") }}</span>
                </CommandItem>
                <CommandItem value="search" class="py-2">
                  <IconSmile />
                  <span>{{ $t("pages.agents.categories.searchEmoji") }}</span>
                </CommandItem>
                <CommandItem value="calculator" class="py-2">
                  <IconCalculator />
                  <span>{{ $t("pages.agents.categories.calculator") }}</span>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
        <Tabs default-value="featured" class="gap-8">
          <div class="bg-background sticky top-0 z-10 py-2">
            <TabsList class="h-auto w-full">
              <Carousel
                class="w-full focus-visible:outline-none"
                :opts="{
                  align: 'start',
                }"
              >
                <CarouselContent class="-ml-2 p-1">
                  <CarouselItem
                    v-for="category in categories"
                    :key="category.id"
                    class="basis-auto pl-2"
                  >
                    <TabsTrigger :value="category.id">
                      {{ category.label }}
                    </TabsTrigger>
                  </CarouselItem>
                </CarouselContent>
                <CarouselPrevious />
                <CarouselNext />
              </Carousel>
            </TabsList>
          </div>
          <TabsContent value="featured" class="grid gap-16">
            <div>
              <h3 class="text-2xl font-bold tracking-tight">
                {{ $t("pages.agents.sections.featured") }}
              </h3>
              <p class="text-muted-foreground">
                {{ $t("pages.agents.sections.featuredDescription") }}
              </p>
            </div>
            <div>
              <Carousel
                class="focus-visible:outline-none"
                :opts="{
                  align: 'start',
                  loop: true,
                }"
              >
                <CarouselContent class="-ml-6">
                  <CarouselItem
                    v-for="(_, index) in 6"
                    :key="index"
                    class="basis-full pl-6 md:basis-1/2 lg:basis-1/3"
                  >
                    <Card class="h-full shadow-none">
                      <CardHeader class="flex items-start gap-4">
                        <div class="flex flex-col gap-2">
                          <CardTitle class="flex items-center gap-3 text-base">
                            <Avatar
                              variant="beam"
                              :name="`Agent ${index + 1}`"
                              :colors="[
                                'var(--color-chart-1)',
                                'var(--color-chart-2)',
                                'var(--color-chart-3)',
                                'var(--color-chart-4)',
                                'var(--color-chart-5)',
                              ]"
                            />
                            Agent {{ index + 1 }}
                          </CardTitle>
                          <CardDescription class="text-xs">
                            This is a description for Agent {{ index + 1 }}. It
                            can perform various tasks.
                          </CardDescription>
                          <div class="flex items-center justify-between gap-2">
                            <div
                              class="text-secondary-foreground flex items-center text-xs font-medium"
                            >
                              Agent Network
                            </div>
                            <div
                              class="text-secondary-foreground flex items-center gap-1 text-xs"
                            >
                              <IconStar /> 4.5
                              <span class="text-muted-foreground">(35k)</span>
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent class="mt-auto">
                        <Carousel
                          class="focus-visible:outline-none"
                          :opts="{
                            align: 'start',
                            loop: true,
                          }"
                        >
                          <CarouselContent>
                            <CarouselItem>
                              <div
                                class="aspect-video bg-cover bg-center bg-no-repeat"
                                style="
                                  background-image: url(&quot;https://framerusercontent.com/images/FLr1IxUSg9tK6K5eLtfdnzUfkk.png&quot;);
                                "
                              ></div>
                            </CarouselItem>
                            <CarouselItem>
                              <div
                                class="aspect-video bg-cover bg-center bg-no-repeat"
                                style="
                                  background-image: url(&quot;https://framerusercontent.com/images/W6K9ukcWFSpamfFnCjmMmyYT4w.png&quot;);
                                "
                              ></div>
                            </CarouselItem>
                            <CarouselItem>
                              <div
                                class="aspect-video bg-cover bg-center bg-no-repeat"
                                style="
                                  background-image: url(&quot;https://framerusercontent.com/images/08IkYUqVYvZTgOrPDmYUofFh7LU.png&quot;);
                                "
                              ></div>
                            </CarouselItem>
                          </CarouselContent>
                        </Carousel>
                      </CardContent>
                      <CardFooter class="grid grid-cols-2 gap-2">
                        <Button variant="outline">
                          <IconBriefcase />
                          {{ $t("pages.agents.buttons.recruit") }}
                        </Button>
                        <Button variant="secondary">
                          <IconUserRoundPlus />
                          {{ $t("pages.agents.buttons.addToTeam") }}
                        </Button>
                      </CardFooter>
                    </Card>
                  </CarouselItem>
                </CarouselContent>
                <CarouselPrevious />
                <CarouselNext />
              </Carousel>
            </div>
            <div>
              <h3 class="text-2xl font-bold tracking-tight">
                {{ $t("pages.agents.sections.trending") }}
              </h3>
              <p class="text-muted-foreground">
                {{ $t("pages.agents.sections.trendingDescription") }}
              </p>
            </div>
            <div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              <Card v-for="index in 6" :key="index" class="h-full shadow-none">
                <CardHeader class="flex items-start gap-4">
                  <div class="flex flex-col gap-2">
                    <CardTitle class="flex items-center gap-3 text-base">
                      <Avatar
                        :name="`Agent ${index + 1}`"
                        :colors="[
                          'var(--color-chart-1)',
                          'var(--color-chart-2)',
                          'var(--color-chart-3)',
                          'var(--color-chart-4)',
                          'var(--color-chart-5)',
                        ]"
                      />
                      Agent {{ index + 1 }}
                    </CardTitle>
                    <CardDescription class="text-xs">
                      This is a description for Agent {{ index + 1 }}. It can
                      perform various tasks.
                    </CardDescription>
                    <div class="flex items-center justify-between gap-2">
                      <div
                        class="text-secondary-foreground flex items-center text-xs font-medium"
                      >
                        Agent Network
                      </div>
                      <div
                        class="text-secondary-foreground flex items-center gap-1 text-xs"
                      >
                        <IconStar /> 4.5
                        <span class="text-muted-foreground">(35k)</span>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardFooter class="grid grid-cols-2 gap-2">
                  <Button variant="outline">
                    <IconBriefcase /> {{ $t("pages.agents.buttons.recruit") }}
                  </Button>
                  <Button variant="secondary">
                    <IconUserRoundPlus />
                    {{ $t("pages.agents.buttons.addToTeam") }}
                  </Button>
                </CardFooter>
              </Card>
            </div>
            <div>
              <h3 class="text-2xl font-bold tracking-tight">
                {{ $t("pages.agents.sections.byAgentNetwork") }}
              </h3>
              {{ $t("pages.agents.sections.byAgentNetworkDescription") }}
            </div>
            <div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              <Card v-for="index in 6" :key="index" class="h-full shadow-none">
                <CardHeader class="flex items-start gap-4">
                  <div class="flex flex-col gap-2">
                    <CardTitle class="flex items-center gap-3 text-base">
                      <Avatar
                        :name="`Agent ${index + 1}`"
                        :colors="[
                          'var(--color-chart-1)',
                          'var(--color-chart-2)',
                          'var(--color-chart-3)',
                          'var(--color-chart-4)',
                          'var(--color-chart-5)',
                        ]"
                      />
                      Agent {{ index + 1 }}
                    </CardTitle>
                    <CardDescription class="text-xs">
                      This is a description for Agent {{ index + 1 }}. It can
                      perform various tasks.
                    </CardDescription>
                    <div class="flex items-center justify-between gap-2">
                      <div
                        class="text-secondary-foreground flex items-center text-xs font-medium"
                      >
                        Agent Network
                      </div>
                      <div
                        class="text-secondary-foreground flex items-center gap-1 text-xs"
                      >
                        <IconStar /> 4.5
                        <span class="text-muted-foreground">(35k)</span>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardFooter class="grid grid-cols-2 gap-2">
                  <Button variant="outline">
                    <IconBriefcase /> {{ $t("pages.agents.buttons.recruit") }}
                  </Button>
                  <Button variant="secondary">
                    <IconUserRoundPlus />
                    {{ $t("pages.agents.buttons.addToTeam") }}
                  </Button>
                </CardFooter>
              </Card>
            </div>
          </TabsContent>
          <TabsContent value="writing" class="grid gap-16">
            writing content goes here
          </TabsContent>
        </Tabs>
      </div>
    </div>
  </OverlayScrollbarsWrapper>
  <Teleport defer to="#right-sidebar">
    <Sidebar collapsible="none" class="w-full"></Sidebar>
  </Teleport>
</template>

<!-- <style scoped>
.router-link-active {
  @apply before:absolute;
  @apply before:z-10;
  @apply before:inset-y-0;
  @apply before:-left-1;
  @apply before:w-2;
  @apply before:bg-sidebar-primary;
}
</style> -->
