<script lang="ts" setup>
import {
  IconCommand,
  IconHelpCircle,
  IconKeyboard,
  IconRocket,
} from "@/data/icons"
import { getPlatformSpecialKey } from "@/helpers/shortcuts"
import { emitter } from "@/modules/mitt"

type ActionItem = {
  title: string
  icon: Component
  keys: string[]
  event: string
}

const actionItems: ActionItem[] = [
  {
    title: "Ask AI anything",
    icon: IconRocket,
    keys: [getPlatformSpecialKey(), "↩"],
    event: "Dialog.AiAsk.Toggle",
  },
  {
    title: "Search and commands",
    icon: IconCommand,
    keys: [getPlatformSpecialKey(), "K"],
    event: "Dialog.Command.Open",
  },
  {
    title: "Keyboard shortcuts",
    icon: IconKeyboard,
    keys: [getPlatformSpecialKey(), "/"],
    event: "Dialog.Shortcuts.Open",
  },
  {
    title: "Help and support",
    icon: IconHelpCircle,
    keys: ["?"],
    event: "Menu.Help.Toggle",
  },
]
</script>

<template>
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <Logo />
      </EmptyMedia>
      <EmptyTitle> Welcome to Lectornaut </EmptyTitle>
      <EmptyDescription>
        Get started by using the commands below to explore the app.
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <ItemGroup class="grid grid-cols-1 gap-2">
        <Item
          v-for="item in actionItems"
          :key="item.event"
          variant="muted"
          size="sm"
          class="hover:bg-secondary cursor-pointer"
          @click="emitter.emit(item.event)"
        >
          <ItemMedia class="text-muted-foreground">
            <Component :is="item.icon" />
          </ItemMedia>
          <ItemContent class="gap-0.5 truncate">
            <ItemTitle class="text-secondary-foreground">
              {{ item.title }}
            </ItemTitle>
          </ItemContent>
          <ItemActions class="pl-16">
            <KbdGroup>
              <Kbd v-for="key in item.keys" :key="key">{{ key }}</Kbd>
            </KbdGroup>
          </ItemActions>
        </Item>
      </ItemGroup>
    </EmptyContent>
  </Empty>
</template>
