<script setup lang="ts">
import { ResizablePanel } from "@/components/ui/resizable"
import emitter from "@/modules/mitt"

const leftPanel = ref<InstanceType<typeof ResizablePanel>>()
const rightPanel = ref<InstanceType<typeof ResizablePanel>>()

emitter.on("Sidebar.Left.Toggle", () => {
  if (leftPanel.value?.splitterPanel?.isCollapsed) {
    leftPanel.value?.splitterPanel?.expand()
  } else {
    leftPanel.value?.splitterPanel?.collapse()
  }
})

emitter.on("Sidebar.Right.Toggle", () => {
  if (rightPanel.value?.splitterPanel?.isCollapsed) {
    rightPanel.value?.splitterPanel?.expand()
  } else {
    rightPanel.value?.splitterPanel?.collapse()
  }
})
</script>

<template>
  <main class="flex grow overflow-auto overscroll-none">
    <MainSidebar class="shadow-border z-10 shadow-[1px_0px_0px]" />
    <div id="left-dock"></div>
    <ResizablePanelGroup direction="horizontal" auto-save-id="app-layout">
      <ResizablePanel
        ref="leftPanel"
        collapsible
        :min-size="15"
        :default-size="16"
        :max-size="22"
        :collapsed-size="0"
        as-child
        class="hidden lg:flex"
      >
        <div id="left-sidebar"></div>
      </ResizablePanel>
      <ResizableHandle
        class="data-[state=hover]:bg-primary focus-visible:ring-primary focus-visible:bg-primary data-[state=drag]:bg-primary z-10 hidden transition focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none lg:flex"
      />
      <ResizablePanel class="flex grow flex-col overflow-auto overscroll-none">
        <Tabbar />
        <SubNavigation />
        <Separator />
        <div class="flex grow flex-col overflow-auto overscroll-none">
          <RouterView />
        </div>
      </ResizablePanel>
      <ResizableHandle
        class="data-[state=hover]:bg-primary focus-visible:ring-primary focus-visible:bg-primary data-[state=drag]:bg-primary z-10 hidden transition focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none lg:flex"
      />
      <ResizablePanel
        ref="rightPanel"
        collapsible
        :min-size="15"
        :default-size="16"
        :max-size="22"
        :collapsed-size="0"
        as-child
        class="hidden lg:flex"
      >
        <div id="right-sidebar"></div>
      </ResizablePanel>
    </ResizablePanelGroup>
    <div id="right-dock"></div>
  </main>
</template>
