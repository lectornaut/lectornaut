<template>
  <Sidebar collapsible="none" class="w-[calc(var(--sidebar-width-icon))]">
    <!-- <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton class="aspect-square p-0">
            <div
              class="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square w-full items-center justify-center"
            >
              <icon-lucide-lab-peach />
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader> -->
    <SidebarContent>
      <Navigation />
    </SidebarContent>
    <SidebarFooter>
      <Members />
      <Separator />
      <Support />
      <AccountMenu />
    </SidebarFooter>
  </Sidebar>
</template>
