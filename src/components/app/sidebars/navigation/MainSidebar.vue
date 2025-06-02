<template>
  <Sidebar collapsible="none" class="w-[calc(var(--sidebar-width-icon))]">
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" class="md:h-8 md:p-0">
            <div
              class="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg"
            >
              <icon-lucide-lab-peach class="size-4" />
            </div>
            <div class="grid flex-1 text-left leading-tight">
              <span class="truncate font-semibold">Acme Inc</span>
              <span class="truncate text-xs">Enterprise</span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
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
