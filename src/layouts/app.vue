<template>
  <SidebarProvider
    :default-open="false"
    class="flex grow flex-col overflow-auto overscroll-none [--footer-height:--spacing(5)] [--header-height:--spacing(13)]"
  >
    <Titlebar />
    <Separator />
    <main class="flex grow overflow-auto overscroll-none">
      <MainSidebar />
      <Separator orientation="vertical" />
      <ResizablePanelGroup direction="horizontal" auto-save-id="app-layout">
        <ResizablePanel
          ref="leftPanel"
          collapsible
          :min-size="15"
          :default-size="20"
          :max-size="25"
          :collapsed-size="0"
          as-child
          class="hidden lg:flex"
        >
          <LeftSidebar />
        </ResizablePanel>
        <ResizableHandle class="hidden lg:flex" />
        <ResizablePanel
          class="flex grow flex-col overflow-auto overscroll-none"
        >
          <Tabbar />
          <SubNavigation />
          <Separator />
          <div class="flex grow flex-col overflow-auto overscroll-none">
            <RouterView />
          </div>
        </ResizablePanel>
        <ResizableHandle class="hidden lg:flex" />
        <ResizablePanel
          ref="rightPanel"
          collapsible
          :min-size="15"
          :default-size="20"
          :max-size="25"
          :collapsed-size="0"
          as-child
          class="hidden lg:flex"
        >
          <RightSidebar />
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
    <Separator />
    <Footbar />
  </SidebarProvider>
</template>
