<template>
  <Sidebar
    collapsible="none"
    class="bg-background w-[calc(var(--sidebar-width-icon))]"
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
      <AccountMenu />
    </SidebarFooter>
  </Sidebar>
</template>
