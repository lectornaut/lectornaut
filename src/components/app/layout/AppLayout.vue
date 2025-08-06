<script setup lang="ts">
import { ResizablePanel } from "@/components/ui/resizable"
import emitter from "@/modules/mitt"

const leftPanel = ref<InstanceType<typeof ResizablePanel>>()
const rightPanel = ref<InstanceType<typeof ResizablePanel>>()
const bottomPanel = ref<InstanceType<typeof ResizablePanel>>()

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

emitter.on("Sidebar.Bottom.Toggle", () => {
  if (bottomPanel.value?.splitterPanel?.isCollapsed) {
    bottomPanel.value?.splitterPanel?.expand()
  } else {
    bottomPanel.value?.splitterPanel?.collapse()
  }
})
</script>

<template>
  <main class="flex grow overflow-auto overscroll-none">
    <MainSidebar class="shadow-border z-10 shadow-[1px_0px_0px]" />
    <div id="left-dock"></div>
    <ResizablePanelGroup
      direction="horizontal"
      auto-save-id="app-horizontal-layout"
    >
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
      <ResizablePanel>
        <ResizablePanelGroup
          direction="vertical"
          auto-save-id="app-vertical-layout"
        >
          <ResizablePanel
            class="flex grow flex-col overflow-auto overscroll-none"
            collapsible
            :min-size="15"
            :default-size="80"
            :max-size="100"
            :collapsed-size="0"
          >
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
            ref="bottomPanel"
            collapsible
            :min-size="15"
            :default-size="20"
            :max-size="100"
            :collapsed-size="0"
            as-child
            class="hidden lg:flex"
          >
            <div id="bottom-sidebar" class="bg-sidebar/50 w-full"></div>
          </ResizablePanel>
        </ResizablePanelGroup>
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
  <div
    data-tauri-drag-region
    class="pb-safe-bottom shadow-border z-0 grid shrink-0 grid-cols-3 gap-2 shadow-[0px_-1px_0px]"
  >
    <div class="flex items-center justify-start" data-tauri-drag-region></div>
    <div class="flex items-center justify-center" data-tauri-drag-region></div>
    <div class="flex items-center justify-end" data-tauri-drag-region>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="sm"
              class="rounded-none"
              @click="emitter.emit('Sidebar.Left.Toggle')"
            >
              <icon-tabler-layout-sidebar
                v-if="leftPanel?.splitterPanel?.isCollapsed"
              />
              <icon-tabler-layout-sidebar-filled v-else />
            </Button>
          </TooltipTrigger>
          <TooltipContent> Left panel </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="sm"
              class="rounded-none"
              @click="emitter.emit('Sidebar.Bottom.Toggle')"
            >
              <icon-tabler-layout-bottombar
                v-if="bottomPanel?.splitterPanel?.isCollapsed"
              />
              <icon-tabler-layout-bottombar-filled v-else />
            </Button>
          </TooltipTrigger>
          <TooltipContent> Bottom panel </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="sm"
              class="rounded-none"
              @click="emitter.emit('Sidebar.Right.Toggle')"
            >
              <icon-tabler-layout-sidebar-right
                v-if="rightPanel?.splitterPanel?.isCollapsed"
              />
              <icon-tabler-layout-sidebar-right-filled v-else />
            </Button>
          </TooltipTrigger>
          <TooltipContent> Right panel </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  </div>
</template>
