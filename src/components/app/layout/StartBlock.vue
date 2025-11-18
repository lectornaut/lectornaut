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
          <ItemMedia variant="icon">
            <icon-lucide-command />
          </ItemMedia>
          <ItemContent>
            <ItemTitle> Search and Commands </ItemTitle>
          </ItemContent>
          <ItemActions>
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </ItemActions>
        </Item>
        <Item variant="muted" size="sm">
          <ItemMedia variant="icon">
            <icon-lucide-rocket />
          </ItemMedia>
          <ItemContent>
            <ItemTitle> Ask AI </ItemTitle>
          </ItemContent>
          <ItemActions>
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>↩</Kbd>
            </KbdGroup>
          </ItemActions>
        </Item>
        <Item variant="muted" size="sm">
          <ItemMedia variant="icon">
            <icon-lucide-keyboard />
          </ItemMedia>
          <ItemContent>
            <ItemTitle> Keyboard Shortcuts </ItemTitle>
          </ItemContent>
          <ItemActions>
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>/</Kbd>
            </KbdGroup>
          </ItemActions>
        </Item>
        <Item variant="muted" size="sm">
          <ItemMedia variant="icon">
            <icon-lucide-help-circle />
          </ItemMedia>
          <ItemContent>
            <ItemTitle> Help and Support </ItemTitle>
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
