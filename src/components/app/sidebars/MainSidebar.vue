<script setup lang="ts">
const iconDisplay = ref<"icon" | "text">("icon")
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger>
      <Sidebar
        collapsible="none"
        class="shadow-border relative z-20 w-[calc(var(--sidebar-width-icon))] shadow-[1px_0px]"
      >
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem class="flex h-9 items-center justify-center p-2">
              <Logo />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <Separator />
        <SidebarContent>
          <OverlayScrollbarsWrapper>
            <Navigation :icon-display="iconDisplay" />
          </OverlayScrollbarsWrapper>
        </SidebarContent>
        <Separator />
        <SidebarFooter>
          <Members />
          <Separator />
          <Support />
          <SettingsMenu />
          <AccountMenu />
        </SidebarFooter>
      </Sidebar>
    </ContextMenuTrigger>
    <ContextMenuContent align="end" side="bottom">
      <ContextMenuLabel class="text-muted-foreground text-xs">
        Appearance
      </ContextMenuLabel>
      <ContextMenuRadioGroup v-model="iconDisplay">
        <ContextMenuRadioItem value="icon"> Icons only </ContextMenuRadioItem>
        <ContextMenuRadioItem value="text">
          Icons and text
        </ContextMenuRadioItem>
      </ContextMenuRadioGroup>
    </ContextMenuContent>
  </ContextMenu>
</template>
