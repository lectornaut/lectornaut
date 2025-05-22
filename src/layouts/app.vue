<template>
  <SidebarProvider
    class="no-scrollbar flex grow flex-col overflow-auto overscroll-none [--footer-height:--spacing(5)] [--header-height:--spacing(13)]"
  >
    <Titlebar />
    <Separator />
    <div class="no-scrollbar flex grow overflow-hidden overscroll-none">
      <LeftSidebar
        class="top-[calc(var(--header-height)+1px)] bottom-[calc(var(--footer-height)+1px)] h-[calc(100svh-var(--header-height)-var(--footer-height)-2px))]"
      />
      <div
        class="no-scrollbar flex grow flex-col overflow-auto overscroll-none"
      >
        <Tabbar />
        <SubNavigation />
        <Separator />
        <RouterView />
      </div>
    </div>
    <Separator />
    <Footbar />
  </SidebarProvider>
</template>
