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
        <Item variant="muted" size="sm">
          <ItemMedia class="text-muted-foreground">
            <icon-lucide-command />
          </ItemMedia>
          <ItemContent>
            <ItemTitle class="text-secondary-foreground">
              Search and Commands
            </ItemTitle>
          </ItemContent>
          <ItemActions class="pl-16">
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
          <ItemActions class="pl-16">
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
          <ItemActions class="pl-16">
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
