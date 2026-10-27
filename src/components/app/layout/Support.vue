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
import { setCurrentUserOnboardingState } from "@/queries/userSettings"
import confetti from "canvas-confetti"
import { driver } from "driver.js"
import "driver.js/dist/driver.css"

const { t } = useI18n()
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
  onDestroyed: (_element, _step, { state, config }) => {
    if (state.activeIndex === (config.steps?.length ?? 0) - 1) handleClick()
  },
  overlayColor: "var(--foreground)",
  smoothScroll: true,
  stagePadding: 4,
  stageRadius: 32,
  popoverClass: "driverjs-theme",
  popoverOffset: 8,
  showProgress: true,
  nextBtnText: t("components.support.tour.next"),
  prevBtnText: t("components.support.tour.previous"),
  doneBtnText: t("components.support.tour.finish"),
  overlayOpacity: 0.25,
  steps: [
    {
      popover: {
        title: t("components.support.tour.steps.welcome.title"),
        description: t("components.support.tour.steps.welcome.description"),
      },
    },
    {
      element: "#tour-tasks-notifications",
      popover: {
        title: t("components.support.tour.steps.tasksNotifications.title"),
        description: t(
          "components.support.tour.steps.tasksNotifications.description"
        ),
        side: "bottom",
        align: "start",
      },
    },
    {
      element: '#tour-workspace-switcher [data-sidebar="menu-button"]',
      popover: {
        title: t("components.support.tour.steps.workspaceSwitcher.title"),
        description: t(
          "components.support.tour.steps.workspaceSwitcher.description"
        ),
        side: "bottom",
        align: "center",
      },
    },
    {
      element: "#tour-search-bar",
      popover: {
        title: t("components.support.tour.steps.searchBar.title"),
        description: t("components.support.tour.steps.searchBar.description"),
        side: "bottom",
        align: "end",
      },
    },
    {
      element: "#tour-ai-assistant",
      popover: {
        title: t("components.support.tour.steps.aiAssistant.title"),
        description: t("components.support.tour.steps.aiAssistant.description"),
        side: "bottom",
        align: "center",
      },
    },
    {
      element: '#tour-team-switcher [data-sidebar="menu-button"]',
      popover: {
        title: t("components.support.tour.steps.teamSwitcher.title"),
        description: t(
          "components.support.tour.steps.teamSwitcher.description"
        ),
        side: "bottom",
        align: "center",
      },
    },
    {
      element: "#tour-primary-navigation",
      popover: {
        title: t("components.support.tour.steps.primaryNavigation.title"),
        description: t(
          "components.support.tour.steps.primaryNavigation.description"
        ),
        side: "right",
        align: "start",
      },
    },
    {
      element: "#tour-team-members",
      popover: {
        title: t("components.support.tour.steps.teamMembers.title"),
        description: t("components.support.tour.steps.teamMembers.description"),
        side: "right",
        align: "start",
      },
    },
    {
      element: '#tour-help-support [data-sidebar="menu-button"]',
      popover: {
        title: t("components.support.tour.steps.helpSupport.title"),
        description: t("components.support.tour.steps.helpSupport.description"),
        side: "right",
        align: "end",
      },
    },
    {
      element: '#tour-account-menu [data-sidebar="menu-button"]',
      popover: {
        title: t("components.support.tour.steps.accountMenu.title"),
        description: t("components.support.tour.steps.accountMenu.description"),
        side: "right",
        align: "end",
      },
    },
    {
      popover: {
        title: t("components.support.tour.steps.happyCoding.title"),
        description: t("components.support.tour.steps.happyCoding.description"),
      },
    },
  ],
})

const selectedCategory = ref("")
const supportCategories = ["demo", "pricing", "support", "feedback", "other"]

const selectedCompanySize = ref()
const companySizes = ["1-99", "100-299", "300-1999", "2000+"]

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
          <DropdownMenuContent>
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
                <DropdownMenuSubContent>
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
            <FieldGroup class="mt-4 gap-4">
              <div class="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel for="first-name">
                    {{ $t("components.support.firstName") }}
                  </FieldLabel>
                  <Input
                    id="first-name"
                    type="text"
                    :placeholder="
                      $t('components.support.placeholders.firstName')
                    "
                  />
                </Field>
                <Field>
                  <FieldLabel for="last-name">
                    {{ $t("components.support.lastName") }}
                  </FieldLabel>
                  <Input
                    id="last-name"
                    type="text"
                    :placeholder="
                      $t('components.support.placeholders.lastName')
                    "
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel for="email">
                  {{ $t("components.support.workEmail") }}
                </FieldLabel>
                <Input
                  id="email"
                  type="email"
                  :placeholder="$t('components.support.placeholders.email')"
                />
              </Field>
              <Field>
                <FieldLabel for="company-size">
                  {{ $t("components.support.companySize") }}
                </FieldLabel>
                <Select v-model="selectedCompanySize">
                  <SelectTrigger>
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
                        :key="size"
                        :value="size"
                      >
                        {{ $t(`components.support.companySizes.${size}`) }}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel for="category">
                  {{ $t("components.support.category") }}
                </FieldLabel>
                <Select v-model="selectedCategory">
                  <SelectTrigger>
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
                        :key="item"
                        :value="item"
                      >
                        {{ $t(`components.support.categories.${item}`) }}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field v-if="selectedCategory === 'other'">
                <FieldLabel for="message">{{
                  $t("components.support.message")
                }}</FieldLabel>
                <Textarea
                  id="message"
                  :placeholder="
                    $t('components.support.placeholders.howCanWeHelp')
                  "
                  class="resize-none"
                />
              </Field>
            </FieldGroup>
          </DialogHeader>
          <DialogFooter>
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
