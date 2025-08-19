<template>
  <ContextMenu>
    <ContextMenuTrigger>
      <Sidebar
        collapsible="none"
        class="shadow-border z-20 w-[calc(var(--sidebar-width-icon))] shadow-[1px_0px]"
      >
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton>
                <Logo />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <OverlayScrollbarsWrapper>
            <Navigation />
          </OverlayScrollbarsWrapper>
        </SidebarContent>
        <SidebarFooter>
          <Members />
          <Separator />
          <Support />
          <SettingsMenu />
          <AccountMenu />
        </SidebarFooter>
      </Sidebar>
    </ContextMenuTrigger>
    <div id="main-sidebar-context-menu"></div>
  </ContextMenu>
</template>
