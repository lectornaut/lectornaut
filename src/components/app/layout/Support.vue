<script setup lang="ts">
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
      popover: {
        title: "Happy Coding",
        description:
          "And that is all, go ahead and start adding tours to your applications.",
      },
    },
  ],
})
</script>

<template>
  <SidebarMenuItem>
    <TooltipProvider>
      <Tooltip>
        <DropdownMenu v-model:open="openSupport">
          <TooltipTrigger as-child>
            <DropdownMenuTrigger as-child>
              <SidebarMenuButton class="data-[state=open]:bg-accent">
                <icon-lucide-circle-help />
                Help & Support
              </SidebarMenuButton>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right" class="flex items-center gap-2">
            Help and Support
            <kbd class="shortcut-key">?</kbd>
          </TooltipContent>
          <DropdownMenuContent class="w-48" align="end" side="right">
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <icon-lucide-message-circle />
                Contact us
              </DropdownMenuItem>
              <DropdownMenuItem @click="productTour.drive()">
                <icon-lucide-circle-play />
                Product tour
              </DropdownMenuItem>
              <DropdownMenuItem>
                <icon-lucide-book-open />

                Documentation <icon-lucide-arrow-up-right />
              </DropdownMenuItem>
              <DropdownMenuItem
                class="gap-2"
                @click="emitter.emit('Dialog.Shortcuts.Open')"
              >
                <icon-lucide-keyboard />
                Shortcuts
                <DropdownMenuShortcut>⌘ /</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuItem class="gap-2" as-child>
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
                      Terms of Service <icon-lucide-arrow-up-right />
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      Privacy Policy <icon-lucide-arrow-up-right />
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel class="text-muted-foreground text-xs">
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
              <DropdownMenuItem>
                <icon-lucide-circle-dot-dashed />
                AI for Agents
              </DropdownMenuItem>
              <DropdownMenuItem>
                <icon-lucide-circle-dot-dashed />
                Sales Pipeline
              </DropdownMenuItem>
              <DropdownMenuItem>
                <icon-lucide-circle-dot />
                Full changelog <icon-lucide-arrow-up-right />
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </Tooltip>
    </TooltipProvider>
  </SidebarMenuItem>
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
