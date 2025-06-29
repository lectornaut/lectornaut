<script setup lang="ts">
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
  <Tabs default-value="details" class="bg-card gap-0">
    <SidebarHeader>
      <div class="flex items-center justify-between gap-2">
        <span class="text-foreground ml-2 text-base font-medium">
          {{ route.meta.sidebar }}
        </span>
        <Button variant="ghost">
          <icon-lucide-plus />
          <span>New</span>
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
            class="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center px-3"
          >
            <icon-lucide-search />
          </span>
          <SidebarInput class="pl-9" placeholder="Search" />
          <!-- <span
            class="absolute inset-y-0 end-0 flex items-center justify-center"
          >
          </span> -->
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon">
                <icon-lucide-list-filter />
              </Button>
            </TooltipTrigger>
            <TooltipContent> Filter </TooltipContent>
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
              class="ring-offset-background focus-visible:ring-ring/50 rounded-md focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <Card class="rounded-md shadow-none">
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
                    <icon-mdi-circle />
                    <span>
                      {{ getStatus().text }}
                    </span>
                  </Badge>
                  <Badge variant="secondary">
                    <icon-lucide-hash />
                    <span> {{ Math.floor(Math.random() * 60) }} RUNS </span>
                  </Badge>
                  <Badge variant="secondary">
                    <icon-lucide-clock />
                    <span> {{ Math.floor(Math.random() * 60) }} HOURS </span>
                  </Badge>
                </CardContent>
              </Card>
            </RouterLink>
          </SidebarGroupContent>
        </SidebarGroup>
      </OverlayScrollbarsWrapper>
    </SidebarContent>
  </Tabs>
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
