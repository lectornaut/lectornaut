<script lang="ts" setup>
import {
  IconCommand,
  IconHelpCircle,
  IconKeyboard,
  IconRocket,
} from "@/data/icons"
import { getPlatformSpecialKey } from "@/helpers/shortcuts"
</script>

<template>
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <Logo class="h-6 w-6" />
      </EmptyMedia>
      <EmptyTitle> Welcome to Lectornaut </EmptyTitle>
      <EmptyDescription>
        Get started by using the commands below to explore the app.
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <ItemGroup class="grid grid-cols-1 gap-2">
        <Item variant="muted" size="sm">
          <ItemMedia class="text-muted-foreground">
            <IconCommand />
          </ItemMedia>
          <ItemContent>
            <ItemTitle class="text-secondary-foreground">
              Search and Commands
            </ItemTitle>
          </ItemContent>
          <ItemActions class="pl-16">
            <KbdGroup>
              <Kbd>{{ getPlatformSpecialKey() }}</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </ItemActions>
        </Item>
        <Item variant="muted" size="sm">
          <ItemMedia class="text-muted-foreground">
            <IconRocket />
          </ItemMedia>
          <ItemContent>
            <ItemTitle class="text-secondary-foreground"> Ask AI </ItemTitle>
          </ItemContent>
          <ItemActions class="pl-16">
            <KbdGroup>
              <Kbd>{{ getPlatformSpecialKey() }}</Kbd>
              <Kbd>↩</Kbd>
            </KbdGroup>
          </ItemActions>
        </Item>
        <Item variant="muted" size="sm">
          <ItemMedia class="text-muted-foreground">
            <IconKeyboard />
          </ItemMedia>
          <ItemContent>
            <ItemTitle class="text-secondary-foreground">
              Keyboard Shortcuts
            </ItemTitle>
          </ItemContent>
          <ItemActions class="pl-16">
            <KbdGroup>
              <Kbd>{{ getPlatformSpecialKey() }}</Kbd>
              <Kbd>/</Kbd>
            </KbdGroup>
          </ItemActions>
        </Item>
        <Item variant="muted" size="sm">
          <ItemMedia class="text-muted-foreground">
            <IconHelpCircle />
          </ItemMedia>
          <ItemContent>
            <ItemTitle class="text-secondary-foreground">
              Help and Support
            </ItemTitle>
          </ItemContent>
          <ItemActions class="pl-16">
            <KbdGroup>
              <Kbd>?</Kbd>
            </KbdGroup>
          </ItemActions>
        </Item>
      </ItemGroup>
    </EmptyContent>
  </Empty>
</template>
