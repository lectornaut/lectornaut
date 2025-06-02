<script setup lang="ts">
import { ResizablePanel } from "@/components/ui/resizable"
import emitter from "@/modules/mitt"

const leftPanel = ref<InstanceType<typeof ResizablePanel>>()
const rightPanel = ref<InstanceType<typeof ResizablePanel>>()

emitter.on("Sidebar.Left.Toggle", () => {
  console.log("Toggling left panel", leftPanel)
  leftPanel?.value?.isCollapsed
    ? leftPanel?.value?.expand()
    : leftPanel?.value?.collapse()
})

emitter.on("Sidebar.Right.Toggle", () => {
  console.log("Toggling right panel", rightPanel)
  rightPanel?.value?.isCollapsed
    ? rightPanel?.value?.expand()
    : rightPanel?.value?.collapse()
})
</script>

<template>
  <!-- <button
    @click="
      leftPanel?.isCollapsed ? leftPanel?.expand() : leftPanel?.collapse()
    "
  >
    {{ leftPanel?.isCollapsed ? "Expand Left" : "Collapse Left" }}
  </button>
  <button
    @click="
      rightPanel?.isCollapsed ? rightPanel?.expand() : rightPanel?.collapse()
    "
  >
    {{ rightPanel?.isCollapsed ? "Expand Right" : "Collapse Right" }}
  </button> -->
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
      <ResizableHandle
        class="data-[state=hover]:bg-sidebar-border focus-visible:ring-sidebar-border focus-visible:bg-sidebar-border data-[state=drag]:bg-sidebar-border z-10 hidden transition focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none lg:flex"
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
        class="data-[state=hover]:bg-sidebar-border focus-visible:ring-sidebar-border focus-visible:bg-sidebar-border data-[state=drag]:bg-sidebar-border z-10 hidden transition focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none lg:flex"
      />
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
</template>
