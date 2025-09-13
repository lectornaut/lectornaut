<script setup lang="ts">
import { ResizablePanel } from "@/components/ui/resizable"
import { generateId } from "@/helpers/utilities"
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

const source = ref<{ id: string; label: string }[]>([])

const iconDisplay = ref<"icon" | "text">("icon")

const activeTab = ref<string>(source.value[0]?.id || "")

const newTab = () => {
  const id = generateId()
  source.value.push({ id, label: `Tab ${id}` })
  activeTab.value = id
}

const setActiveTab = (id: string) => {
  activeTab.value = id
}

const closeTab = (id: string) => {
  const index = source.value.findIndex((tab) => tab.id === id)
  if (index !== -1) {
    source.value.splice(index, 1)
    if (activeTab.value === id) {
      if (source.value.length > 0) {
        const newIndex = index === 0 ? 0 : index - 1
        if (source.value[newIndex]) {
          activeTab.value = `tab-${source.value[newIndex].id}`
        } else {
          activeTab.value = ""
        }
      } else {
        activeTab.value = ""
      }
    }
  }
}
</script>

<template>
  <main class="flex grow overflow-auto overscroll-none">
    <MainSidebar />
    <div id="left-dock"></div>
    <ResizablePanelGroup
      direction="horizontal"
      auto-save-id="app-horizontal-layout"
    >
      <ContextMenu>
        <ContextMenuTrigger as-child>
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
            <div id="left-sidebar" ref="leftSidebarEl"></div>
          </ResizablePanel>
        </ContextMenuTrigger>
        <ContextMenuContent align="end" side="bottom">
          <ContextMenuItem @click="leftPanel?.splitterPanel?.collapse()">
            <icon-lucide-x /> Close panel
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <ResizableHandle
        class="data-[state=hover]:bg-primary focus-visible:ring-primary focus-visible:bg-primary data-[state=drag]:bg-primary isolate z-30 hidden transition focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none lg:flex"
        @dblclick="
          leftPanel?.splitterPanel?.isCollapsed
            ? leftPanel?.splitterPanel?.expand()
            : leftPanel?.splitterPanel?.collapse()
        "
      />
      <ResizablePanel>
        <ResizablePanelGroup
          direction="vertical"
          auto-save-id="app-vertical-layout"
        >
          <ContextMenu>
            <ContextMenuTrigger as-child>
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
            </ContextMenuTrigger>
            <ContextMenuContent align="end" side="bottom">
              <ContextMenuItem>
                <icon-lucide-refresh-ccw /> Refresh
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem>
                <icon-lucide-arrow-left /> Go back
              </ContextMenuItem>
              <ContextMenuItem>
                <icon-lucide-arrow-right /> Go forward
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          <ResizableHandle
            class="data-[state=hover]:bg-primary focus-visible:ring-primary focus-visible:bg-primary data-[state=drag]:bg-primary isolate z-30 transition focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none"
            @dblclick="
              bottomPanel?.splitterPanel?.isCollapsed
                ? bottomPanel?.splitterPanel?.expand()
                : bottomPanel?.splitterPanel?.collapse()
            "
          />
          <ContextMenu>
            <ContextMenuTrigger as-child>
              <ResizablePanel
                ref="bottomPanel"
                collapsible
                :min-size="15"
                :default-size="20"
                :max-size="100"
                :collapsed-size="0"
                as-child
              >
                <Tabs v-model="activeTab">
                  <div
                    id="bottom-sidebar"
                    class="bg-background flex flex-1 flex-col overflow-auto overscroll-none"
                  >
                    <div class="flex shrink-0">
                      <div
                        class="no-scrollbar flex flex-1 items-center justify-start overflow-auto"
                      >
                        <TabsList class="bg-transparent p-0">
                          <TabsTrigger
                            v-for="tab in source"
                            :key="tab.id"
                            class="data-[state=active]:text-foreground hover:text-accent-foreground text-muted-foreground relative h-full rounded-none text-xs uppercase data-[state=active]:!border-transparent data-[state=active]:!bg-transparent data-[state=active]:shadow-none"
                            :class="{
                              'after:bg-primary after:absolute after:inset-x-0 after:-bottom-px after:z-30 after:h-px':
                                activeTab === tab.id,
                            }"
                            :value="tab.id"
                            @click="setActiveTab(tab.id)"
                          >
                            <span class="max-w-32 truncate">
                              {{ tab.label }}
                            </span>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger as-child>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    class="size-4"
                                    @click.stop="closeTab(tab.id)"
                                  >
                                    <icon-lucide-x class="!size-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent> Close tab </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </TabsTrigger>
                        </TabsList>
                        <div
                          class="bg-background after:bg-border sticky right-0 z-30 flex h-full items-center justify-center after:absolute after:inset-x-0 after:bottom-0 after:z-20 after:h-px"
                        >
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger as-child>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  class="rounded-none"
                                  @click="newTab()"
                                >
                                  <icon-lucide-plus />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent> New </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </div>
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
                                  ? "Minimize panel"
                                  : "Maximize panel"
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
                            <TooltipContent> Close panel </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </div>
                    <OverlayScrollbarsWrapper
                      class="shadow-border z-20 shadow-[0px_-1px]"
                    >
                      <TabsContent
                        v-for="tab in source"
                        :key="tab.id"
                        :value="tab.id"
                        class="size-full"
                      >
                        <Terminal />
                      </TabsContent>
                      <div class="flex size-full flex-col items-center">
                        <div
                          v-if="source.length === 0"
                          class="flex max-w-xs flex-col items-center justify-center gap-4 p-8 text-center"
                        >
                          <icon-mingcute-layer-fill
                            class="size-16 rounded-lg border border-dashed p-4"
                          />
                          <h3 class="font-medium">Lectornaut CLI</h3>
                          <p class="text-muted-foreground text-xs text-balance">
                            No active sessions. Create a new console to get
                            started.
                          </p>
                          <Button @click="newTab()"> Open Console </Button>
                        </div>
                      </div>
                    </OverlayScrollbarsWrapper>
                  </div>
                </Tabs>
              </ResizablePanel>
            </ContextMenuTrigger>
            <ContextMenuContent align="end" side="bottom">
              <ContextMenuItem
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
                {{
                  topPanel?.splitterPanel?.isCollapsed
                    ? "Collapse panel"
                    : "Expand panel"
                }}
              </ContextMenuItem>
              <ContextMenuItem @click="bottomPanel?.splitterPanel?.collapse()">
                <icon-lucide-x /> Close panel
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle
        class="data-[state=hover]:bg-primary focus-visible:ring-primary focus-visible:bg-primary data-[state=drag]:bg-primary isolate z-30 hidden transition focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none lg:flex"
        @dblclick="
          rightPanel?.splitterPanel?.isCollapsed
            ? rightPanel?.splitterPanel?.expand()
            : rightPanel?.splitterPanel?.collapse()
        "
      />
      <ContextMenu>
        <ContextMenuTrigger as-child>
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
            <div id="right-sidebar" ref="rightSidebarEl"></div>
          </ResizablePanel>
        </ContextMenuTrigger>
        <ContextMenuContent align="end" side="bottom">
          <ContextMenuItem @click="rightPanel?.splitterPanel?.collapse()">
            <icon-lucide-x /> Close panel
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </ResizablePanelGroup>
    <div id="right-dock"></div>
  </main>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <div
        data-tauri-drag-region
        class="pb-safe-bottom shadow-border relative z-20 grid shrink-0 grid-cols-3 gap-2 shadow-[0px_-1px]"
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
    <ContextMenuContent align="end" side="bottom">
      <ContextMenuLabel class="text-muted-foreground text-xs">
        Appearance
      </ContextMenuLabel>
      <ContextMenuRadioGroup v-model="iconDisplay">
        <ContextMenuRadioItem value="icon"> Icons only </ContextMenuRadioItem>
        <ContextMenuRadioItem value="text">
          Icons and text
        </ContextMenuRadioItem>
      </ContextMenuRadioGroup>
    </ContextMenuContent>
  </ContextMenu>
</template>
