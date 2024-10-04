<script setup lang="ts">
const components: { title: string; href: string; description: string }[] = [
  {
    title: "Alert Dialog",
    href: "/docs/primitives/alert-dialog",
    description:
      "A modal dialog that interrupts the user with important content and expects a response.",
  },
  {
    title: "Hover Card",
    href: "/docs/primitives/hover-card",
    description:
      "For sighted users to preview content available behind a link.",
  },
  {
    title: "Progress",
    href: "/docs/primitives/progress",
    description:
      "Displays an indicator showing the completion progress of a task, typically displayed as a progress bar.",
  },
  {
    title: "Scroll-area",
    href: "/docs/primitives/scroll-area",
    description: "Visually or semantically separates content.",
  },
  {
    title: "Tabs",
    href: "/docs/primitives/tabs",
    description:
      "A set of layered sections of content—known as tab panels—that are displayed one at a time.",
  },
  {
    title: "Tooltip",
    href: "/docs/primitives/tooltip",
    description:
      "A popup that displays information related to an element when the element receives keyboard focus or the mouse hovers over it.",
  },
  {
    title: "Visually Hidden",
    href: "/docs/primitives/visually-hidden",
    description:
      "Hides content visually but remains accessible to screen readers.",
  },
  {
    title: "Dialog",
    href: "/docs/primitives/dialog",
    description:
      "A modal dialog that interrupts the user with important content and expects a response.",
  },
  {
    title: "Disclosure",
    href: "/docs/primitives/disclosure",
    description:
      "A disclosure is a button that controls visibility of a section of content.",
  },
  {
    title: "Menu",
    href: "/docs/primitives/menu",
    description:
      "A type of composite widget that functions as a group of menuitem elements.",
  },
  {
    title: "Menu Button",
    href: "/docs/primitives/menu-button",
    description: "A button that controls the visibility of a menu.",
  },
  {
    title: "Radio Group",
    href: "/docs/primitives/radio-group",
    description:
      "A group of radio buttons that allows only one radio button to be selected.",
  },
  {
    title: "Switch",
    href: "/docs/primitives/switch",
    description:
      "A type of checkbox that represents on/off values, like a light switch.",
  },
  {
    title: "Tab",
    href: "/docs/primitives/tab",
    description: "A single panel in a set of tab panels.",
  },
  {
    title: "Tab Group",
    href: "/docs/primitives/tab-group",
    description: "A group of tabs that functions as a composite widget.",
  },
  {
    title: "Tooltip",
    href: "/docs/primitives/tooltip",
    description:
      "A popup that displays information related to an element when the element receives keyboard focus or the mouse hovers over it.",
  },
  {
    title: "Visually Hidden",
    href: "/docs/primitives/visually-hidden",
    description:
      "Hides content visually but remains accessible to screen readers.",
  },
  {
    title: "Dialog",
    href: "/docs/primitives/dialog",
    description:
      "A modal dialog that interrupts the user with important content and expects a response.",
  },
]
</script>

<template>
  <NavigationMenu>
    <NavigationMenuList>
      <NavigationMenuItem>
        <NavigationMenuTrigger class="h-7 gap-2 px-2" size="xs">
          <span
            class="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
          >
            <icon-lucide-check-check />
          </span>
          Tasks
        </NavigationMenuTrigger>
        <NavigationMenuContent>
          <div class="w-96 -translate-x-px">
            <div
              class="sticky top-0 flex items-center justify-between border-b bg-background py-2 pl-4 pr-2"
            >
              <h3 class="text-sm font-semibold">Tasks</h3>
              <Button size="xs" variant="ghost" class="gap-2">
                <icon-lucide-plus /> New Task
              </Button>
            </div>
            <div
              class="no-scrollbar flex h-96 grow flex-col overflow-y-auto p-2"
            >
              <NavigationMenuLink
                v-for="(component, index) in components"
                :key="index"
                as-child
              >
                <Button
                  size="lg"
                  variant="ghost"
                  class="flex h-auto items-start justify-start gap-3 whitespace-normal px-3 py-2 leading-normal"
                  as-child
                >
                  <RouterLink :key="index" :to="component.href">
                    <icon-lucide-asterisk class="h-5 w-5" />
                    <div class="flex flex-col">
                      <span class="text-sm font-medium">{{
                        component.title
                      }}</span>
                      <span class="text-muted-foreground">
                        {{ component.description }}
                      </span>
                    </div>
                  </RouterLink>
                </Button>
              </NavigationMenuLink>
            </div>
          </div>
        </NavigationMenuContent>
      </NavigationMenuItem>
      <NavigationMenuItem>
        <NavigationMenuTrigger class="h-7 gap-2 px-2" size="xs">
          <span
            class="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
          >
            <icon-lucide-bell />
          </span>
          Notifications
        </NavigationMenuTrigger>
        <NavigationMenuContent>
          <div class="w-96 -translate-x-px">
            <div
              class="sticky top-0 flex items-center justify-between border-b bg-background py-2 pl-4 pr-2"
            >
              <h3 class="text-sm font-semibold">Notifications</h3>
              <Button size="xs" variant="ghost" class="gap-2">
                <icon-lucide-check-check /> Makr all as read
              </Button>
            </div>
            <div
              class="no-scrollbar flex h-96 grow flex-col overflow-y-auto p-2"
            >
              <NavigationMenuLink
                v-for="(component, index) in components"
                :key="index"
                as-child
              >
                <Button
                  size="lg"
                  variant="ghost"
                  class="flex h-auto items-start justify-start gap-3 whitespace-normal px-3 py-2 leading-normal"
                  as-child
                >
                  <RouterLink :key="index" :to="component.href">
                    <icon-lucide-asterisk class="h-5 w-5" />
                    <div class="flex flex-col">
                      <span class="text-sm font-medium">{{
                        component.title
                      }}</span>
                      <span class="text-muted-foreground">
                        {{ component.description }}
                      </span>
                    </div>
                  </RouterLink>
                </Button>
              </NavigationMenuLink>
            </div>
          </div>
        </NavigationMenuContent>
      </NavigationMenuItem>
    </NavigationMenuList>
  </NavigationMenu>
</template>
