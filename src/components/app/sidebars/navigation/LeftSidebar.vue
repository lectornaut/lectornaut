<script setup lang="ts">
import { useSidebar } from "@/components/ui/sidebar"
import { Layers2, Workflow } from "lucide-vue-next"
import { OverlayScrollbarsComponent } from "overlayscrollbars-vue"
import { useCurrentUser } from "vuefire"

const user = useCurrentUser()
const userData = {
  name: user.value?.displayName || "",
  email: user.value?.email || "",
  avatar: user.value?.photoURL || "",
}

// This is sample data
const data = {
  navMain: [
    {
      title: "Workflows",
      url: "/workflows",
      icon: Workflow,
      isActive: true,
    },
    {
      title: "Drafts",
      url: "/drafts",
      icon: Layers2,
      isActive: false,
    },
  ],
  mails: [
    {
      name: "William Smith",
      active: false,
      email: "williamsmith@example.com",
      subject: "Meeting Tomorrow",
      date: "09:34 AM",
      teaser:
        "Hi team, just a reminder about our meeting tomorrow at 10 AM.\nPlease come prepared with your project updates.",
    },
    {
      name: "Alice Smith",
      active: false,
      email: "alicesmith@example.com",
      subject: "Re: Project Update",
      date: "Yesterday",
      teaser:
        "Thanks for the update. The progress looks great so far.\nLet's schedule a call to discuss the next steps.",
    },
    {
      name: "Bob Johnson",
      active: false,
      email: "bobjohnson@example.com",
      subject: "Weekend Plans",
      date: "2 days ago",
      teaser:
        "Hey everyone! I'm thinking of organizing a team outing this weekend.\nWould you be interested in a hiking trip or a beach day?",
    },
    {
      name: "Emily Davis",
      active: false,
      email: "emilydavis@example.com",
      subject: "Re: Question about Budget",
      date: "2 days ago",
      teaser:
        "I've reviewed the budget numbers you sent over.\nCan we set up a quick call to discuss some potential adjustments?",
    },
    {
      name: "Michael Wilson",
      active: false,
      email: "michaelwilson@example.com",
      subject: "Important Announcement",
      date: "1 week ago",
      teaser:
        "Please join us for an all-hands meeting this Friday at 3 PM.\nWe have some exciting news to share about the company's future.",
    },
    {
      name: "Sarah Brown",
      active: false,
      email: "sarahbrown@example.com",
      subject: "Re: Feedback on Proposal",
      date: "1 week ago",
      teaser:
        "Thank you for sending over the proposal. I've reviewed it and have some thoughts.\nCould we schedule a meeting to discuss my feedback in detail?",
    },
    {
      name: "David Lee",
      active: false,
      email: "davidlee@example.com",
      subject: "New Project Idea",
      date: "1 week ago",
      teaser:
        "I've been brainstorming and came up with an interesting project concept.\nDo you have time this week to discuss its potential impact and feasibility?",
    },
    {
      name: "Olivia Wilson",
      active: false,
      email: "oliviawilson@example.com",
      subject: "Vacation Plans",
      date: "1 week ago",
      teaser:
        "Just a heads up that I'll be taking a two-week vacation next month.\nI'll make sure all my projects are up to date before I leave.",
    },
    {
      name: "James Martin",
      active: false,
      email: "jamesmartin@example.com",
      subject: "Re: Conference Registration",
      date: "1 week ago",
      teaser:
        "I've completed the registration for the upcoming tech conference.\nLet me know if you need any additional information from my end.",
    },
    {
      name: "Sophia White",
      active: false,
      email: "sophiawhite@example.com",
      subject: "Team Dinner",
      date: "1 week ago",
      teaser:
        "To celebrate our recent project success, I'd like to organize a team dinner.\nAre you available next Friday evening? Please let me know your preferences.",
    },
  ],
}

const activeItem = ref(data.navMain[0])
const mails = ref(data.mails)
const { setOpen, state } = useSidebar()

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
</script>

<template>
  <Sidebar collapsible="icon" class="[&>[data-sidebar=sidebar]]:flex-row">
    <Sidebar
      collapsible="none"
      class="w-[calc(var(--sidebar-width-icon)+1px)] border-r"
    >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" as-child class="md:h-8 md:p-0">
              <RouterLink to="/home">
                <div
                  class="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg"
                >
                  <icon-mdi-circle class="size-4" />
                </div>
                <div class="grid flex-1 text-left leading-tight">
                  <span class="truncate font-semibold">Acme Inc</span>
                  <span class="truncate text-xs">Enterprise</span>
                </div>
              </RouterLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <OverlayScrollbarsComponent
          defer
          :options="{ scrollbars: { autoHide: 'scroll' } }"
        >
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem v-for="item in data.navMain" :key="item.title">
                  <SidebarMenuButton
                    :tooltip="item.title"
                    :is-active="
                      activeItem?.title === item.title && state === 'expanded'
                    "
                    as-child
                    @click="
                      () => {
                        if (
                          state === 'expanded' &&
                          activeItem?.title === item.title
                        ) {
                          setOpen(false)
                        } else {
                          activeItem = item
                          setOpen(true)
                        }
                      }
                    "
                  >
                    <RouterLink :to="item.url">
                      <component :is="item.icon" />
                      <span class="truncate">{{ item.title }}</span>
                    </RouterLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </OverlayScrollbarsComponent>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <Support />
          <SettingsMenu />
        </SidebarMenu>
        <NavUser :user="userData" />
      </SidebarFooter>
    </Sidebar>
    <Sidebar collapsible="none" class="hidden flex-1 overflow-hidden md:flex">
      <SidebarHeader class="border-b border-dashed">
        <div class="flex items-center justify-between gap-2">
          <span class="text-foreground ml-2 text-base font-medium">
            {{ activeItem?.title }}
          </span>
          <Button variant="ghost" class="gap-2">
            <icon-lucide-plus />
            <span class="truncate">New</span>
          </Button>
        </div>
      </SidebarHeader>
      <SidebarHeader>
        <div class="flex items-center justify-between gap-2">
          <div class="relative flex h-full items-center justify-between gap-2">
            <span
              class="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center px-3"
            >
              <icon-lucide-search />
            </span>
            <SidebarInput class="h-full pl-9" placeholder="Search" />
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
        <OverlayScrollbarsComponent
          defer
          :options="{ scrollbars: { autoHide: 'scroll' } }"
        >
          <SidebarGroup>
            <SidebarGroupContent class="grid gap-2">
              <RouterLink
                v-for="(mail, index) in mails"
                :key="mail.email"
                :to="`/workflows/${index}`"
                class="ring-offset-background focus-visible:ring-ring rounded-lg focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                @click="() => (mail.active = !mail.active)"
              >
                <Card
                  class="rounded-md shadow-none"
                  :class="{ 'border-primary': mail.active }"
                >
                  <CardHeader>
                    <CardTitle class="flex w-full justify-between">
                      <span class="truncate">{{ mail.name }}</span>
                    </CardTitle>
                    <CardDescription class="line-clamp-1">
                      {{ mail.subject }}
                    </CardDescription>
                  </CardHeader>
                  <CardContent class="flex flex-col gap-1">
                    <Badge variant="secondary" :class="getStatus().class">
                      <icon-mdi-circle />
                      <span class="truncate">
                        {{ getStatus().text }}
                      </span>
                    </Badge>
                    <Badge variant="secondary">
                      <icon-lucide-hash />
                      <span class="truncate">
                        {{ Math.floor(Math.random() * 60) }} RUNS
                      </span>
                    </Badge>
                    <Badge variant="secondary">
                      <icon-lucide-clock />
                      <span class="truncate">
                        {{ Math.floor(Math.random() * 60) }} HOURS
                      </span>
                    </Badge>
                  </CardContent>
                </Card>
              </RouterLink>
            </SidebarGroupContent>
          </SidebarGroup>
        </OverlayScrollbarsComponent>
      </SidebarContent>
    </Sidebar>
    <SidebarRail />
  </Sidebar>
</template>
