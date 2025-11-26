<script lang="ts" setup>
import { IconBell, IconBookmark, IconCheck } from "@/data/icons"
const notifications = [
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
  <OverlayScrollbarsWrapper>
    <ItemGroup>
      <template v-for="(component, index) in notifications" :key="index">
        <Item>
          <ItemMedia variant="icon">
            <IconBell />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{{ component.title }}</ItemTitle>
            <ItemDescription>
              {{ component.description }}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <ToggleGroup type="single" variant="outline">
              <ToggleGroupItem value="saved">
                <IconBookmark />
                <!-- Save -->
              </ToggleGroupItem>
              <ToggleGroupItem value="done">
                <IconCheck />
                <!-- Done -->
              </ToggleGroupItem>
            </ToggleGroup>
          </ItemActions>
        </Item>
        <ItemSeparator v-if="index !== notifications.length - 1" />
      </template>
    </ItemGroup>
  </OverlayScrollbarsWrapper>
</template>
