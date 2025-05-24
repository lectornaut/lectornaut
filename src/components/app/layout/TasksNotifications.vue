<script setup lang="ts">
import { OverlayScrollbarsComponent } from "overlayscrollbars-vue"

const components: { title: string; href: string; description: string }[] = [
  {
    title: "Alert Dialog",
    description:
      "A modal dialog that interrupts the user with important content and expects a response.",
    href: "",
  },
  {
    title: "Hover Card",
    description:
      "For sighted users to preview content available behind a link.",
    href: "",
  },
  {
    title: "Progress",
    description:
      "Displays an indicator showing the completion progress of a task, typically displayed as a progress bar.",
    href: "",
  },
  {
    title: "Scroll-area",
    description: "Visually or semantically separates content.",
    href: "",
  },
  {
    title: "Tabs",
    description:
      "A set of layered sections of content—known as tab panels—that are displayed one at a time.",
    href: "",
  },
  {
    title: "Tooltip",
    description:
      "A popup that displays information related to an element when the element receives keyboard focus or the mouse hovers over it.",
    href: "",
  },
  {
    title: "Visually Hidden",
    description:
      "Hides content visually but remains accessible to screen readers.",
    href: "",
  },
  {
    title: "Dialog",
    description:
      "A modal dialog that interrupts the user with important content and expects a response.",
    href: "",
  },
  {
    title: "Disclosure",
    description:
      "A disclosure is a button that controls visibility of a section of content.",
    href: "",
  },
  {
    title: "Menu",
    description:
      "A type of composite widget that functions as a group of menuitem elements.",
    href: "",
  },
  {
    title: "Menu Button",
    description: "A button that controls the visibility of a menu.",
    href: "",
  },
  {
    title: "Radio Group",
    description:
      "A group of radio buttons that allows only one radio button to be selected.",
    href: "",
  },
  {
    title: "Switch",
    description:
      "A type of checkbox that represents on/off values, like a light switch.",
    href: "",
  },
  {
    title: "Tab",
    description: "A single panel in a set of tab panels.",
    href: "",
  },
  {
    title: "Tab Group",
    description: "A group of tabs that functions as a composite widget.",
    href: "",
  },
  {
    title: "Tooltip",
    description:
      "A popup that displays information related to an element when the element receives keyboard focus or the mouse hovers over it.",
    href: "",
  },
  {
    title: "Visually Hidden",
    description:
      "Hides content visually but remains accessible to screen readers.",
    href: "",
  },
  {
    title: "Dialog",
    description:
      "A modal dialog that interrupts the user with important content and expects a response.",
    href: "",
  },
]
</script>

<template>
  <NavigationMenu class="z-40">
    <NavigationMenuList class="flex items-center gap-2">
      <NavigationMenuItem>
        <NavigationMenuTrigger>
          <icon-lucide-check />
          <!-- <span> Tasks </span> -->
        </NavigationMenuTrigger>
        <NavigationMenuContent class="p-0">
          <div class="w-80">
            <div
              class="bg-background sticky top-0 z-10 flex items-center justify-between border-b p-2"
            >
              <h3 class="ml-2 font-semibold">Tasks</h3>
              <Button variant="ghost"> <icon-lucide-plus /> New Task </Button>
            </div>
            <div class="no-scrollbar flex h-72 grow flex-col overflow-y-auto">
              <OverlayScrollbarsComponent
                defer
                :options="{ scrollbars: { autoHide: 'scroll' } }"
              >
                <div class="grid gap-2 p-2">
                  <NavigationMenuLink
                    v-for="(component, index) in components"
                    :key="index"
                    as-child
                  >
                    <Alert class="group relative">
                      <icon-lucide-check />
                      <AlertTitle>
                        {{ component.title }}
                      </AlertTitle>
                      <AlertDescription
                        class="text-muted-foreground text-xs text-pretty"
                      >
                        {{ component.description }}
                      </AlertDescription>
                      <div
                        class="animate-in fade-in zoom-in absolute right-2 bottom-2 z-10 hidden items-center gap-2 group-hover:flex"
                      >
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger as-child>
                              <Button size="icon">
                                <icon-lucide-check-check />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent> Mark as read </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </Alert>
                  </NavigationMenuLink>
                </div>
              </OverlayScrollbarsComponent>
            </div>
          </div>
        </NavigationMenuContent>
      </NavigationMenuItem>
      <NavigationMenuItem>
        <NavigationMenuTrigger>
          <icon-lucide-bell />
          <!-- <span> Notifications </span> -->
        </NavigationMenuTrigger>
        <NavigationMenuContent class="p-0">
          <div class="w-80">
            <div
              class="bg-background sticky top-0 z-10 flex items-center justify-between border-b p-2"
            >
              <h3 class="ml-2 font-semibold">Notifications</h3>
              <Button variant="ghost">
                <icon-lucide-check-check /> Mark all as read
              </Button>
            </div>
            <div class="no-scrollbar flex h-72 grow flex-col overflow-y-auto">
              <OverlayScrollbarsComponent
                defer
                :options="{ scrollbars: { autoHide: 'scroll' } }"
              >
                <div class="grid gap-2 p-2">
                  <NavigationMenuLink
                    v-for="(component, index) in components"
                    :key="index"
                    as-child
                  >
                    <Alert class="group relative">
                      <icon-lucide-bell />
                      <AlertTitle>
                        {{ component.title }}
                      </AlertTitle>
                      <AlertDescription
                        class="text-muted-foreground text-xs text-pretty"
                      >
                        {{ component.description }}
                      </AlertDescription>
                      <div
                        class="animate-in fade-in zoom-in absolute right-2 bottom-2 z-10 hidden items-center gap-2 group-hover:flex"
                      >
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger as-child>
                              <Button size="icon">
                                <icon-lucide-check-check />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent> Mark as read </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </Alert>
                  </NavigationMenuLink>
                </div>
              </OverlayScrollbarsComponent>
            </div>
          </div>
        </NavigationMenuContent>
      </NavigationMenuItem>
    </NavigationMenuList>
  </NavigationMenu>
</template>
