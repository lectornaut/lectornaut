<script lang="ts" setup>
import { changelog } from "@/data/changelog"
import {
  IconArrowUpRight,
  IconBadgeCheck,
  IconBookOpen,
  IconCalendar,
  IconCircleDotDashed,
  IconCircleHelp,
  IconCirclePlay,
  IconEllipsis,
  IconGift,
  IconKeyboard,
  IconMessageCircle,
} from "@/data/icons"
import { emitter } from "@/modules/mitt"
import { state } from "@/modules/theme"
import { updateUserData } from "@/queries/updateUserData"
import confetti from "canvas-confetti"
import { driver } from "driver.js"
import "driver.js/dist/driver.css"

const version = import.meta.env.VITE_APP_VERSION

const openSupport = ref(false)

emitter.on("Menu.Help.Toggle", () => {
  openSupport.value = !openSupport.value
})

const handleClick = () => {
  const end = Date.now() + 1 * 1000 // 1 second
  const colors = ["#a786ff", "#fd8bbc", "#eca184", "#f8deb1"]

  const frame = () => {
    if (Date.now() > end) return

    confetti({
      particleCount: 2,
      angle: 60,
      spread: 55,
      startVelocity: 60,
      origin: { x: 0, y: 0.5 },
      colors: colors,
    })

    confetti({
      particleCount: 2,
      angle: 120,
      spread: 55,
      startVelocity: 60,
      origin: { x: 1, y: 0.5 },
      colors: colors,
    })

    requestAnimationFrame(frame)
  }

  frame()
}

const productTour = driver({
  showButtons: ["next", "previous"],
  onDestroyed: () => {
    handleClick()
  },
  overlayColor: state.value === "light" ? "black" : "white",
  smoothScroll: true,
  stagePadding: 4,
  stageRadius: 14,
  popoverClass: "driverjs-theme",
  popoverOffset: 8,
  showProgress: true,
  nextBtnText: "Next",
  prevBtnText: "Previous",
  doneBtnText: "Finish",
  overlayOpacity: 0.25,
  steps: [
    {
      popover: {
        title: "Welcome to Lectornaut",
        description:
          "This is a product tour to help you get started with Lectornaut.",
      },
    },
    {
      element: "#tour-apps-menu",
      popover: {
        title: "Apps menu",
        description:
          "You can access all the apps from the apps menu. This is useful to quickly navigate between different apps.",
        side: "right",
        align: "start",
      },
    },
    {
      element: "#tour-tasks-notifications",
      popover: {
        title: "Tasks and notifications",
        description:
          "You can manage your tasks and notifications here. This is useful to keep track of your work.",
        side: "bottom",
        align: "start",
      },
    },
    {
      element: "#tour-team-switcher",
      popover: {
        title: "Select your team",
        description:
          "You can switch between teams using the team switcher. This is useful if you are part of multiple teams.",
        side: "bottom",
        align: "center",
      },
    },
    {
      element: "#tour-search-bar",
      popover: {
        title: "Search and commands",
        description:
          "You can search for anything using the search bar. This is useful if you want to quickly find something.",
        side: "bottom",
        align: "end",
      },
    },
    {
      element: "#tour-ai-assistant",
      popover: {
        title: "AI Assistant",
        description:
          "You can interact with the AI assistant from here. This is useful if you need help with your tasks.",
        side: "bottom",
        align: "center",
      },
    },
    {
      element: "#tour-primary-navigation",
      popover: {
        title: "Primary navigation",
        description:
          "This is the primary navigation. You can use it to navigate between different sections of the application.",
        side: "right",
        align: "start",
      },
    },
    {
      element: "#tour-team-members",
      popover: {
        title: "Team members",
        description:
          "You can see your team members here. This is useful to know who is working with you.",
        side: "right",
        align: "start",
      },
    },
    {
      element: "#tour-help-support",
      popover: {
        title: "Help and support",
        description:
          "You can access help and support from here. This is useful if you need assistance with the application.",
        side: "right",
        align: "end",
      },
    },
    {
      element: "#tour-account-menu",
      popover: {
        title: "Account menu",
        description:
          "You can manage your account settings from here. This is useful if you want to change your account settings.",
        side: "right",
        align: "end",
      },
    },
    {
      popover: {
        title: "Happy Coding",
        description:
          "And that is all, go ahead and start adding tours to your applications.",
      },
    },
  ],
})

const selectedCategory = ref("")
const supportCategories = [
  { value: "demo", label: "Request a demo" },
  { value: "pricing", label: "Pricing information" },
  { value: "support", label: "Support inquiry" },
  { value: "feedback", label: "Feedback or suggestions" },
  { value: "other", label: "Other" },
]

const selectedCompanySize = ref()
const companySizes = [
  { value: "1-99", label: "1-99 employees" },
  { value: "100-299", label: "100-299 employees" },
  { value: "300-1999", label: "300-1,999 employees" },
  { value: "2000+", label: "2,000+ employees" },
]

const router = useRouter()

const startOnboarding = () => {
  updateUserData({ onboarding: true })
  router.push("/welcome")
}
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem id="tour-help-support">
      <TooltipProvider>
        <Tooltip>
          <Dialog>
            <DropdownMenu v-model:open="openSupport">
              <DropdownMenuTrigger as-child>
                <TooltipTrigger as-child>
                  <SidebarMenuButton class="data-[state=open]:bg-accent">
                    <IconCircleHelp />
                    Help
                  </SidebarMenuButton>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  class="flex items-center gap-1 pr-2"
                >
                  Help and Support
                  <KbdGroup>
                    <Kbd>?</Kbd>
                  </KbdGroup>
                </TooltipContent>
              </DropdownMenuTrigger>
              <DropdownMenuContent class="w-48" align="end" side="right">
                <DropdownMenuGroup>
                  <DropdownMenuItem>
                    <IconMessageCircle />
                    Get support
                  </DropdownMenuItem>
                  <DialogTrigger as-child>
                    <DropdownMenuItem>
                      <IconBadgeCheck />
                      Contact sales
                    </DropdownMenuItem>
                  </DialogTrigger>
                  <DropdownMenuItem @click="productTour.drive()">
                    <IconCirclePlay />
                    Product tour
                  </DropdownMenuItem>
                  <DropdownMenuItem @click="startOnboarding">
                    <IconGift />
                    Onboarding tour
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <IconBookOpen />
                    Documentation <IconArrowUpRight />
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="emitter.emit('Dialog.Shortcuts.Open')"
                  >
                    <IconKeyboard />
                    Shortcuts
                    <DropdownMenuShortcut>⌘ /</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuItem as-child>
                      <DropdownMenuSubTrigger>
                        <IconEllipsis />
                        More
                      </DropdownMenuSubTrigger>
                    </DropdownMenuItem>
                    <DropdownMenuSubContent>
                      <DropdownMenuGroup>
                        <DropdownMenuItem>
                          Status <IconArrowUpRight />
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          Terms of service <IconArrowUpRight />
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          Privacy policy <IconArrowUpRight />
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuLabel
                          class="text-muted-foreground text-xs"
                        >
                          Lectornaut v{{ version }}
                        </DropdownMenuLabel>
                      </DropdownMenuGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel class="text-muted-foreground text-xs">
                  What's new
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    v-for="(log, index) in changelog.slice(0, 2)"
                    :key="index"
                    @click="emitter.emit('Dialog.Changelog.Open', log.id)"
                  >
                    <IconCircleDotDashed />
                    <span class="truncate">{{ log.title }}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="emitter.emit('Dialog.Changelog.Open')"
                  >
                    <IconCalendar />
                    Full changelog
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DialogContent class="w-sm max-w-fit">
              <DialogHeader>
                <DialogTitle> Contact sales </DialogTitle>
                <DialogDescription>
                  Fill out the form below to contact our sales team. We will get
                  back to you as soon as possible.
                </DialogDescription>
                <div class="mt-4 grid gap-4">
                  <div class="grid grid-cols-2 gap-4">
                    <div class="grid gap-2">
                      <Label
                        class="text-secondary-foreground text-xs"
                        for="first-name"
                      >
                        First name
                      </Label>
                      <Input id="first-name" type="text" placeholder="Ada" />
                    </div>
                    <div class="grid gap-2">
                      <Label
                        class="text-secondary-foreground text-xs"
                        for="last-name"
                      >
                        Last name
                      </Label>
                      <Input
                        id="last-name"
                        type="text"
                        placeholder="Lovelace"
                      />
                    </div>
                  </div>
                  <div class="grid gap-2">
                    <Label
                      class="text-secondary-foreground text-xs"
                      for="email"
                    >
                      Work email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="ada@lovelace.com"
                    />
                  </div>
                  <div class="grid gap-2">
                    <Label
                      class="text-secondary-foreground text-xs"
                      for="company-size"
                    >
                      Company size
                    </Label>
                    <Select v-model="selectedCompanySize">
                      <SelectTrigger class="w-full">
                        <SelectValue placeholder="Number of employees" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem
                          v-for="size in companySizes"
                          :key="size.value"
                          :value="size.value"
                        >
                          {{ size.label }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div class="grid gap-2">
                    <Label
                      class="text-secondary-foreground text-xs"
                      for="category"
                    >
                      Category
                    </Label>
                    <Select v-model="selectedCategory">
                      <SelectTrigger class="w-full">
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem
                          v-for="item in supportCategories"
                          :key="item.value"
                          :value="item.value"
                        >
                          {{ item.label }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div v-if="selectedCategory === 'other'" class="grid gap-2">
                    <Label
                      class="text-secondary-foreground text-xs"
                      for="message"
                      >Message</Label
                    >
                    <Textarea
                      id="message"
                      placeholder="How can we help you?"
                      class="resize-none"
                    />
                  </div>
                </div>
              </DialogHeader>
              <DialogFooter class="grid grid-cols-1 gap-2">
                <DialogClose as-child>
                  <Button> Send request </Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Tooltip>
      </TooltipProvider>
    </SidebarMenuItem>
    <Shortcuts />
    <Changelog />
    <Settings />
    <ExitTrigger />
  </SidebarMenu>
</template>
