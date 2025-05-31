<script setup lang="ts">
import { changelog } from "@/data/changelog"
import emitter from "@/modules/mitt"
import { state } from "@/modules/theme"
import { driver } from "driver.js"
import "driver.js/dist/driver.css"

const version = import.meta.env.VITE_APP_VERSION

const openSupport = ref(false)

emitter.on("Menu.Help.Toggle", () => {
  openSupport.value = !openSupport.value
})

const productTour = driver({
  overlayColor: state.value === "light" ? "black" : "white",
  smoothScroll: true,
  stagePadding: 4,
  stageRadius: 8,
  popoverClass: "driverjs-theme",
  popoverOffset: 8,
  showProgress: true,
  nextBtnText: "Next",
  prevBtnText: "Previous",
  doneBtnText: "Done",
  overlayOpacity: 0.1,
  steps: [
    {
      popover: {
        title: "Welcome to Hyperjump",
        description:
          "This is a product tour to help you get started with Hyperjump.",
      },
    },
    {
      element: "#tour-team-switcher",
      popover: {
        title: "Select your team",
        description:
          "You can switch between teams using the team switcher. This is useful if you are part of multiple teams.",
        side: "bottom",
        align: "start",
      },
    },
    {
      element: "#tour-search-bar",
      popover: {
        title: "Search and commands",
        description:
          "You can search for anything using the search bar. This is useful if you want to quickly find something.",
        side: "bottom",
        align: "center",
      },
    },
    {
      element: "#tour-tasks-notifications",
      popover: {
        title: "Tasks and notifications",
        description:
          "You can manage your tasks and notifications here. This is useful to keep track of your work.",
        side: "bottom",
        align: "end",
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
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem id="tour-help-support">
      <Tooltip>
        <TooltipProvider>
          <Dialog>
            <DropdownMenu v-model:open="openSupport">
              <DropdownMenuTrigger as-child>
                <TooltipTrigger as-child>
                  <SidebarMenuButton class="data-[state=open]:bg-accent">
                    <icon-lucide-circle-help />
                    Help & Support
                  </SidebarMenuButton>
                </TooltipTrigger>
                <TooltipContent side="right" class="flex items-center gap-1">
                  Help and Support
                  <kbd class="shortcut-key">?</kbd>
                </TooltipContent>
              </DropdownMenuTrigger>
              <DropdownMenuContent class="w-48" align="end" side="right">
                <DropdownMenuGroup>
                  <DropdownMenuItem>
                    <icon-lucide-message-circle />
                    Get support
                  </DropdownMenuItem>
                  <DialogTrigger as-child>
                    <DropdownMenuItem>
                      <icon-lucide-badge-check />
                      Contact sales
                    </DropdownMenuItem>
                  </DialogTrigger>
                  <DropdownMenuItem @click="productTour.drive()">
                    <icon-lucide-circle-play />
                    Product tour
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <icon-lucide-book-open />
                    Documentation <icon-lucide-arrow-up-right />
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="emitter.emit('Dialog.Shortcuts.Open')"
                  >
                    <icon-lucide-keyboard />
                    Shortcuts
                    <DropdownMenuShortcut>⌘ /</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuItem as-child>
                      <DropdownMenuSubTrigger>
                        <icon-lucide-ellipsis />
                        More
                      </DropdownMenuSubTrigger>
                    </DropdownMenuItem>
                    <DropdownMenuSubContent>
                      <DropdownMenuGroup>
                        <DropdownMenuItem>
                          Status <icon-lucide-arrow-up-right />
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          Terms of service <icon-lucide-arrow-up-right />
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          Privacy policy <icon-lucide-arrow-up-right />
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuLabel
                          class="text-muted-foreground text-xs"
                        >
                          Hyperjump v{{ version }}
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
                    <icon-lucide-circle-dot-dashed />
                    <span class="truncate">{{ log.title }}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="emitter.emit('Dialog.Changelog.Open')"
                  >
                    <icon-lucide-calendar />
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
                    <Select>
                      <SelectTrigger class="w-full">
                        <SelectValue placeholder="Number of employees" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1-99">1-99 employees</SelectItem>
                        <SelectItem value="100-299"
                          >100-299 employees</SelectItem
                        >
                        <SelectItem value="300-1999"
                          >300-1,999 employees</SelectItem
                        >
                        <SelectItem value="2000+">2,000+ employees</SelectItem>
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
                        <SelectItem value="demo">Request a demo</SelectItem>
                        <SelectItem value="pricing"
                          >Pricing information</SelectItem
                        >
                        <SelectItem value="support">Support inquiry</SelectItem>
                        <SelectItem value="feedback"
                          >Feedback or suggestions</SelectItem
                        >
                        <SelectItem value="other">Other</SelectItem>
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
        </TooltipProvider>
      </Tooltip>
    </SidebarMenuItem>
    <Shortcuts />
    <Changelog />
    <Settings />
    <ExitTrigger />
  </SidebarMenu>
</template>

<style>
.driver-popover.driverjs-theme {
  @apply bg-background;
  @apply text-foreground;
  @apply border-border;
  @apply p-4;
  @apply shadow-lg;
  @apply rounded-lg;
  @apply min-w-sm;
}

.driver-popover.driverjs-theme .driver-popover-title,
.driver-popover.driverjs-theme .driver-popover-description,
.driver-popover.driverjs-theme .driver-popover-progress-text {
  @apply font-sans;
}

.driver-popover.driverjs-theme .driver-popover-title {
  @apply text-foreground;
  @apply text-lg;
  @apply font-semibold;
  @apply tracking-tight;
}

.driver-popover.driverjs-theme .driver-popover-description {
  @apply text-secondary-foreground;
  @apply text-sm;
  @apply font-medium;
  @apply leading-tight;
}

.driver-popover.driverjs-theme .driver-popover-progress-text {
  @apply text-muted-foreground;
  @apply text-xs;
}

.driver-popover.driverjs-theme .driver-popover-prev-btn,
.driver-popover.driverjs-theme .driver-popover-next-btn {
  @apply font-sans;
  @apply flex;
  @apply items-center;
  @apply justify-center;
  @apply rounded;
  @apply px-3;
  @apply py-2;
  @apply text-sm;
  @apply font-medium;
  @apply transition;
  @apply leading-tight;
  @apply text-shadow-none;
  @apply border-none;
}

.driver-popover.driverjs-theme .driver-popover-prev-btn {
  @apply bg-secondary/80;
  @apply text-secondary-foreground;
  @apply hover:bg-secondary;
}

.driver-popover.driverjs-theme .driver-popover-next-btn {
  @apply bg-sidebar-primary/80;
  @apply text-sidebar-primary-foreground;
  @apply hover:bg-sidebar-primary;
}

.driver-popover.driverjs-theme .driver-popover-close-btn {
  @apply text-muted-foreground;
  @apply hover:text-secondary-foreground;
}

.driver-popover.driverjs-theme
  .driver-popover-arrow-side-left.driver-popover-arrow {
  @apply border-l-background;
}

.driver-popover.driverjs-theme
  .driver-popover-arrow-side-right.driver-popover-arrow {
  @apply border-r-background;
}

.driver-popover.driverjs-theme
  .driver-popover-arrow-side-top.driver-popover-arrow {
  @apply border-t-background;
}

.driver-popover.driverjs-theme
  .driver-popover-arrow-side-bottom.driver-popover-arrow {
  @apply border-b-background;
}
</style>
