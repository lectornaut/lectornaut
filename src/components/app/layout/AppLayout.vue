<script setup lang="ts">
import { ResizablePanel } from "@/components/ui/resizable"
import emitter from "@/modules/mitt"

const leftPanel = ref<InstanceType<typeof ResizablePanel>>()
const rightPanel = ref<InstanceType<typeof ResizablePanel>>()
const topPanel = ref<InstanceType<typeof ResizablePanel>>()
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

emitter.on("Panel.Bottom.Toggle", () => {
  if (bottomPanel.value?.splitterPanel?.isCollapsed) {
    bottomPanel.value?.splitterPanel?.expand()
  } else {
    bottomPanel.value?.splitterPanel?.collapse()
  }
})

const isLoading = ref(false)

setInterval(() => {
  isLoading.value = Math.random() > 0.5
}, 2000)
</script>

<template>
  <main class="flex grow overflow-auto overscroll-none">
    <MainSidebar />
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
        class="data-[state=hover]:bg-primary focus-visible:ring-primary focus-visible:bg-primary data-[state=drag]:bg-primary isolate z-30 hidden transition focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none lg:flex"
      />
      <ResizablePanel>
        <ResizablePanelGroup
          direction="vertical"
          auto-save-id="app-vertical-layout"
        >
          <ResizablePanel
            ref="topPanel"
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
            class="data-[state=hover]:bg-primary focus-visible:ring-primary focus-visible:bg-primary data-[state=drag]:bg-primary isolate z-30 hidden transition focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none lg:flex"
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
            <div id="bottom-sidebar" class="bg-sidebar/50 flex flex-col">
              <div class="grid shrink-0 grid-cols-3 gap-2">
                <div class="flex items-center justify-start"></div>
                <div class="flex items-center justify-center"></div>
                <div class="flex items-center justify-end">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Button
                          variant="ghost"
                          size="icon"
                          class="rounded-none"
                          @click="
                            topPanel?.splitterPanel?.isCollapsed
                              ? topPanel?.splitterPanel?.expand()
                              : topPanel?.splitterPanel?.collapse()
                          "
                        >
                          <icon-lucide-minimize
                            v-if="topPanel?.splitterPanel?.isCollapsed"
                          />
                          <icon-lucide-maximize v-else />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {{
                          topPanel?.splitterPanel?.isCollapsed
                            ? "Minimize"
                            : "Maximize"
                        }}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Button
                          variant="ghost"
                          size="icon"
                          class="rounded-none"
                          @click="bottomPanel?.splitterPanel?.collapse()"
                        >
                          <icon-lucide-x />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent> Close </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
              <Separator />
              <OverlayScrollbarsWrapper>
                <div class="h-80 p-2">content</div>
              </OverlayScrollbarsWrapper>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle
        class="data-[state=hover]:bg-primary focus-visible:ring-primary focus-visible:bg-primary data-[state=drag]:bg-primary isolate z-30 hidden transition focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none lg:flex"
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
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <div
        data-tauri-drag-region
        class="pb-safe-bottom shadow-border z-20 grid shrink-0 grid-cols-3 gap-2 shadow-[0px_-1px]"
      >
        <div class="flex items-center justify-start" data-tauri-drag-region>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="destructive"
                  size="sm"
                  class="w-[calc(var(--sidebar-width-icon))] rounded-none"
                >
                  <icon-lucide-loader-2 v-if="isLoading" class="animate-spin" />
                  <icon-lucide-cloud-check v-else />
                </Button>
              </TooltipTrigger>
              <TooltipContent> Synced to cloud </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="sm" class="rounded-none">
                  <icon-lucide-layers />
                </Button>
              </TooltipTrigger>
              <TooltipContent> Menu </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div
          class="flex items-center justify-center"
          data-tauri-drag-region
        ></div>
        <div class="flex items-center justify-end" data-tauri-drag-region>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="sm" class="rounded-none">
                  <icon-lucide-layout />
                </Button>
              </TooltipTrigger>
              <TooltipContent> Top panel </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="sm"
                  class="rounded-none"
                  @click="emitter.emit('Sidebar.Left.Toggle')"
                >
                  <icon-lucide-panel-left
                    v-if="leftPanel?.splitterPanel?.isCollapsed"
                  />
                  <icon-lucide-panel-left-close v-else />
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
                  @click="emitter.emit('Panel.Bottom.Toggle')"
                >
                  <icon-lucide-panel-bottom
                    v-if="bottomPanel?.splitterPanel?.isCollapsed"
                  />
                  <icon-lucide-panel-bottom-close v-else />
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
                  <icon-lucide-panel-right
                    v-if="rightPanel?.splitterPanel?.isCollapsed"
                  />
                  <icon-lucide-panel-right-close v-else />
                </Button>
              </TooltipTrigger>
              <TooltipContent> Right panel </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </ContextMenuTrigger>
    <ContextMenuContent></ContextMenuContent>
  </ContextMenu>
</template>
