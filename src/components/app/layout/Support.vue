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
import { setCurrentUserOnboardingState } from "@/queries/userSettings"
import confetti from "canvas-confetti"
import { driver } from "driver.js"
import "driver.js/dist/driver.css"

const version = __APP_VERSION__
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
  stageRadius: 12,
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
      element: "#tour-workspace-switcher",
      popover: {
        title: "Switch workspaces",
        description:
          "You can switch between different workspaces using the workspace switcher. This is useful if you are part of multiple workspaces.",
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
  void setCurrentUserOnboardingState(true).catch((error) => {
    console.error("[support] Failed to persist onboarding preference:", error)
  })
  router.push("/welcome")
}
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem id="tour-help-support">
      <Dialog>
        <DropdownMenu v-model:open="openSupport">
          <DropdownMenuTrigger as-child>
            <SidebarMenuButton
              class="data-[state=open]:bg-accent"
              :tooltip="$t('components.support.tooltip')"
            >
              <IconCircleHelp />
              {{ $t("components.support.help") }}
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-auto">
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <IconMessageCircle />
                {{ $t("components.support.getSupport") }}
              </DropdownMenuItem>
              <DialogTrigger as-child>
                <DropdownMenuItem>
                  <IconBadgeCheck />
                  {{ $t("components.support.contactSales") }}
                </DropdownMenuItem>
              </DialogTrigger>
              <DropdownMenuItem @click="productTour.drive()">
                <IconCirclePlay />
                {{ $t("components.support.productTour") }}
              </DropdownMenuItem>
              <DropdownMenuItem @click="startOnboarding">
                <IconGift />
                {{ $t("components.support.onboardingTour") }}
              </DropdownMenuItem>
              <DropdownMenuItem>
                <IconBookOpen />
                {{ $t("components.support.documentation") }}
                <IconArrowUpRight />
              </DropdownMenuItem>
              <DropdownMenuItem @click="emitter.emit('Dialog.Shortcuts.Open')">
                <IconKeyboard />
                {{ $t("components.support.shortcuts") }}
                <DropdownMenuShortcut>⌘ /</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuItem as-child>
                  <DropdownMenuSubTrigger>
                    <IconEllipsis />
                    {{ $t("components.support.more") }}
                  </DropdownMenuSubTrigger>
                </DropdownMenuItem>
                <DropdownMenuSubContent class="w-auto">
                  <DropdownMenuGroup>
                    <DropdownMenuItem>
                      {{ $t("components.support.status") }} <IconArrowUpRight />
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      {{ $t("components.support.termsOfService") }}
                      <IconArrowUpRight />
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      {{ $t("components.support.privacyPolicy") }}
                      <IconArrowUpRight />
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      Lectornaut v{{ version }}
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              {{ $t("components.support.whatsNew") }}
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
              <DropdownMenuItem @click="emitter.emit('Dialog.Changelog.Open')">
                <IconCalendar />
                {{ $t("components.support.fullChangelog") }}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DialogContent class="w-sm max-w-fit">
          <DialogHeader>
            <DialogTitle>
              {{ $t("components.support.contactSalesTitle") }}
            </DialogTitle>
            <DialogDescription>
              {{ $t("components.support.contactSalesDesc") }}
            </DialogDescription>
            <div class="mt-4 grid gap-4">
              <div class="grid grid-cols-2 gap-4">
                <div class="grid gap-2">
                  <Label
                    class="text-secondary-foreground text-xs"
                    for="first-name"
                  >
                    {{ $t("components.support.firstName") }}
                  </Label>
                  <Input
                    id="first-name"
                    type="text"
                    :placeholder="
                      $t('components.support.placeholders.firstName')
                    "
                  />
                </div>
                <div class="grid gap-2">
                  <Label
                    class="text-secondary-foreground text-xs"
                    for="last-name"
                  >
                    {{ $t("components.support.lastName") }}
                  </Label>
                  <Input
                    id="last-name"
                    type="text"
                    :placeholder="
                      $t('components.support.placeholders.lastName')
                    "
                  />
                </div>
              </div>
              <div class="grid gap-2">
                <Label class="text-secondary-foreground text-xs" for="email">
                  {{ $t("components.support.workEmail") }}
                </Label>
                <Input
                  id="email"
                  type="email"
                  :placeholder="$t('components.support.placeholders.email')"
                />
              </div>
              <div class="grid gap-2">
                <Label
                  class="text-secondary-foreground text-xs"
                  for="company-size"
                >
                  {{ $t("components.support.companySize") }}
                </Label>
                <Select v-model="selectedCompanySize">
                  <SelectTrigger class="w-full">
                    <SelectValue
                      :placeholder="
                        $t('components.support.placeholders.employees')
                      "
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem
                        v-for="size in companySizes"
                        :key="size.value"
                        :value="size.value"
                      >
                        {{ size.label }}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div class="grid gap-2">
                <Label class="text-secondary-foreground text-xs" for="category">
                  {{ $t("components.support.category") }}
                </Label>
                <Select v-model="selectedCategory">
                  <SelectTrigger class="w-full">
                    <SelectValue
                      :placeholder="
                        $t('components.support.placeholders.category')
                      "
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem
                        v-for="item in supportCategories"
                        :key="item.value"
                        :value="item.value"
                      >
                        {{ item.label }}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div v-if="selectedCategory === 'other'" class="grid gap-2">
                <Label
                  class="text-secondary-foreground text-xs"
                  for="message"
                  >{{ $t("components.support.message") }}</Label
                >
                <Textarea
                  id="message"
                  :placeholder="
                    $t('components.support.placeholders.howCanWeHelp')
                  "
                  class="resize-none"
                />
              </div>
            </div>
          </DialogHeader>
          <DialogFooter class="grid grid-cols-1 gap-2">
            <DialogClose as-child>
              <Button variant="outline">
                {{ $t("components.support.sendRequest") }}
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
