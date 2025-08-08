<template>
  <Sidebar
    collapsible="none"
    class="w-[calc(var(--sidebar-width-icon))] bg-transparent"
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
</template>
