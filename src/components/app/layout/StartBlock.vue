<template>
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <Logo />
      </EmptyMedia>
    </EmptyHeader>
    <EmptyContent>
      <ItemGroup class="grid grid-cols-1 gap-2">
        <Item variant="muted" size="sm">
          <ItemMedia class="text-muted-foreground">
            <icon-lucide-command />
          </ItemMedia>
          <ItemContent>
            <ItemTitle class="text-secondary-foreground">
              Search and Commands
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </ItemActions>
        </Item>
        <Item variant="muted" size="sm">
          <ItemMedia class="text-muted-foreground">
            <icon-lucide-rocket />
          </ItemMedia>
          <ItemContent>
            <ItemTitle class="text-secondary-foreground"> Ask AI </ItemTitle>
          </ItemContent>
          <ItemActions>
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>↩</Kbd>
            </KbdGroup>
          </ItemActions>
        </Item>
        <Item variant="muted" size="sm">
          <ItemMedia class="text-muted-foreground">
            <icon-lucide-keyboard />
          </ItemMedia>
          <ItemContent>
            <ItemTitle class="text-secondary-foreground">
              Keyboard Shortcuts
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>/</Kbd>
            </KbdGroup>
          </ItemActions>
        </Item>
        <Item variant="muted" size="sm">
          <ItemMedia class="text-muted-foreground">
            <icon-lucide-help-circle />
          </ItemMedia>
          <ItemContent>
            <ItemTitle class="text-secondary-foreground">
              Help and Support
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            <KbdGroup>
              <Kbd>?</Kbd>
            </KbdGroup>
          </ItemActions>
        </Item>
      </ItemGroup>
    </EmptyContent>
  </Empty>
</template>
