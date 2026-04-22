<script lang="ts" setup>
import { ResizablePanel } from "@/components/ui/resizable"
import { useSidebar } from "@/components/ui/sidebar"
import {
  IconArrowBigUp,
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconGripHorizontal,
  IconHand,
  IconLayers,
  IconMaximize,
  IconMinimize,
  IconMinus,
  IconPlus,
  IconPointerClick,
  IconRefreshCcw,
  IconTerminal,
  IconX,
} from "@/data/icons"
import { generateId } from "@/helpers/utilities"
import { emitter } from "@/modules/mitt"
import { useLayoutStore } from "@/stores/layoutStore"
import { UseDraggable as Draggable } from "@vueuse/components"
import { storeToRefs } from "pinia"
import { SplitterPanel } from "reka-ui"

const { t } = useI18n()
const router = useRouter()

const { isMobile, open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar()

const layoutStore = useLayoutStore()
const { leftPanelCollapsed, rightPanelCollapsed, bottomPanelCollapsed } =
  storeToRefs(layoutStore)

const sidebarPanel = ref<InstanceType<typeof SplitterPanel>>()
const leftPanel = ref<InstanceType<typeof SplitterPanel>>()
const rightPanel = ref<InstanceType<typeof SplitterPanel>>()
const topPanel = ref<InstanceType<typeof SplitterPanel>>()
const bottomPanel = ref<InstanceType<typeof SplitterPanel>>()

const syncPanelCollapsed = (
  panel: InstanceType<typeof SplitterPanel> | undefined,
  collapsed: boolean
) => {
  if (!panel) return
  if (collapsed && !panel.isCollapsed) {
    panel.collapse()
  } else if (!collapsed && panel.isCollapsed) {
    panel.expand()
  }
}

const applyPersistedPanelState = () => {
  syncPanelCollapsed(sidebarPanel.value, isMobile.value || !sidebarOpen.value)
  syncPanelCollapsed(leftPanel.value, leftPanelCollapsed.value)
  syncPanelCollapsed(rightPanel.value, rightPanelCollapsed.value)
  syncPanelCollapsed(bottomPanel.value, bottomPanelCollapsed.value)
}

const onSidebarPanelCollapse = () => {
  if (isMobile.value) return
  setSidebarOpen(false)
}

const onSidebarPanelExpand = () => {
  if (isMobile.value) return
  setSidebarOpen(true)
}

const handleSidebarLeftToggle = () => {
  if (leftPanel.value?.isCollapsed) {
    leftPanel.value?.expand()
  } else {
    leftPanel.value?.collapse()
  }
}

const handleSidebarLeftCollapse = () => {
  if (!leftPanel.value?.isCollapsed) {
    leftPanel.value?.collapse()
  }
}

const handleSidebarLeftExpand = () => {
  if (leftPanel.value?.isCollapsed) {
    leftPanel.value?.expand()
  }
}

const handleSidebarRightToggle = () => {
  if (rightPanel.value?.isCollapsed) {
    rightPanel.value?.expand()
  } else {
    rightPanel.value?.collapse()
  }
}

const handleSidebarRightCollapse = () => {
  if (!rightPanel.value?.isCollapsed) {
    rightPanel.value?.collapse()
  }
}

const handleSidebarRightExpand = () => {
  if (rightPanel.value?.isCollapsed) {
    rightPanel.value?.expand()
  }
}

const handlePanelBottomToggle = () => {
  if (bottomPanel.value?.isCollapsed) {
    bottomPanel.value?.expand()
  } else {
    bottomPanel.value?.collapse()
  }
}

onMounted(async () => {
  await nextTick()
  applyPersistedPanelState()

  emitter.on("Sidebar.Left.Toggle", handleSidebarLeftToggle)
  emitter.on("Sidebar.Left.Collapse", handleSidebarLeftCollapse)
  emitter.on("Sidebar.Left.Expand", handleSidebarLeftExpand)
  emitter.on("Sidebar.Right.Toggle", handleSidebarRightToggle)
  emitter.on("Sidebar.Right.Collapse", handleSidebarRightCollapse)
  emitter.on("Sidebar.Right.Expand", handleSidebarRightExpand)
  emitter.on("Panel.Bottom.Toggle", handlePanelBottomToggle)
})

onUnmounted(() => {
  emitter.off("Sidebar.Left.Toggle", handleSidebarLeftToggle)
  emitter.off("Sidebar.Left.Collapse", handleSidebarLeftCollapse)
  emitter.off("Sidebar.Left.Expand", handleSidebarLeftExpand)
  emitter.off("Sidebar.Right.Toggle", handleSidebarRightToggle)
  emitter.off("Sidebar.Right.Collapse", handleSidebarRightCollapse)
  emitter.off("Sidebar.Right.Expand", handleSidebarRightExpand)
  emitter.off("Panel.Bottom.Toggle", handlePanelBottomToggle)
})

watch(
  [
    sidebarOpen,
    leftPanelCollapsed,
    rightPanelCollapsed,
    bottomPanelCollapsed,
    isMobile,
  ],
  () => {
    void nextTick(() => {
      applyPersistedPanelState()
    })
  }
)

const innerWidth = window.innerWidth
const innerHeight = window.innerHeight
const draggableContainer = ref<HTMLElement | null>(null)
const draggableEl = ref<HTMLElement | null>(null)
const draggableHandleEl = ref<HTMLElement | null>(null)
const isPoppedOut = useLocalStorage("popout-state", false)
const isPoppedOutMinimized = useLocalStorage("popout-minimized-state", false)
const observedSize = useLocalStorage("popout-size", { width: 300, height: 400 })
const observedPosition = useLocalStorage("popout-position", { x: 0.5, y: 0.5 })

watch(isPoppedOut, (val) => {
  if (val) {
    isPoppedOutMinimized.value = false
  }
})

useResizeObserver(draggableEl, (entries) => {
  const entry = entries[0]
  if (!entry) return
  if (isPoppedOutMinimized.value) return

  const target = entry.target as HTMLElement
  observedSize.value = {
    width: target.offsetWidth,
    height: target.offsetHeight,
  }
})

const source = ref<{ id: string; label: string }[]>([])

const activeTab = ref<string>(source.value[0]?.id || "")

const newTab = () => {
  const id = generateId()
  source.value.push({ id, label: `Tab` })
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
  <ResizablePanelGroup direction="horizontal" auto-save-id="app-main-layout">
    <ResizablePanel
      ref="sidebarPanel"
      collapsible
      :min-size="15"
      :default-size="20"
      :max-size="25"
      :collapsed-size="0"
      :inert="sidebarPanel?.isCollapsed"
      @collapse="onSidebarPanelCollapse"
      @expand="onSidebarPanelExpand"
    >
      <MainSidebar />
    </ResizablePanel>
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger as-child>
          <ResizableHandle
            class="data-[resize-handle-state=drag]:after:bg-muted-foreground data-[resize-handle-state=hover]:after:bg-muted-foreground data-[resize-handle-state=hover]:bg-muted-foreground data-[resize-handle-state=drag]:bg-muted-foreground focus-visible:after:bg-muted-foreground! z-30 w-0! transition before:pointer-events-auto before:absolute before:inset-y-0 before:left-1/2 before:w-3 before:-translate-x-1/2 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none focus-visible:after:scale-400 data-resize-handle:after:w-px data-[resize-handle-state=drag]:after:scale-400 data-[resize-handle-state=hover]:after:scale-400"
            :class="{
              'data-resize-handle:after:bg-muted': !sidebarPanel?.isCollapsed,
            }"
            @dblclick="
              sidebarPanel?.isCollapsed
                ? sidebarPanel?.expand()
                : sidebarPanel?.collapse()
            "
          />
        </TooltipTrigger>
        <TooltipContent side="right" class="p-1!">
          <div class="flex flex-col gap-1">
            <div class="bg-accent/5 flex flex-col gap-2 p-2">
              <span class="flex items-center gap-2">
                <IconHand /> {{ t("tooltips.dragToResize") }}
              </span>
              <span class="flex items-center gap-2">
                <IconPointerClick />
                {{ t("tooltips.doubleClickToggle") }}
              </span>
            </div>
            <div class="bg-accent/5 flex flex-col gap-2 p-2">
              <span class="flex items-center gap-2">
                <IconArrowRight />
                {{ t("tooltips.rightArrowExpand") }}
              </span>
              <span class="flex items-center gap-2">
                <IconArrowLeft />
                {{ t("tooltips.leftArrowCollapse") }}
              </span>
              <span class="flex items-center gap-2">
                <IconArrowBigUp />
                {{ t("tooltips.shiftLargeSteps") }}
              </span>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
    <ResizablePanel as-child>
      <div class="flex min-h-0 min-w-0 grow flex-col">
        <Tabbar />
        <div
          class="flex min-h-0 min-w-0 grow gap-2 self-stretch overscroll-none scroll-smooth px-2 pb-2"
        >
          <div
            id="left-dock"
            class="shadow-muted-foreground/5 bg-background flex max-w-80 shrink-0 flex-col overflow-clip rounded-xl border shadow empty:hidden"
          ></div>
          <ResizablePanelGroup
            :style="{ overflow: 'clip' }"
            class="shadow-muted-foreground/5 size-full min-h-0 min-w-0 rounded-xl border shadow"
            direction="horizontal"
            auto-save-id="app-horizontal-layout"
          >
            <ContextMenu>
              <ContextMenuTrigger as-child>
                <ResizablePanel
                  ref="leftPanel"
                  collapsible
                  :min-size="15"
                  :default-size="20"
                  :max-size="25"
                  :collapsed-size="0"
                  as-child
                  :inert="leftPanel?.isCollapsed"
                  @collapse="leftPanelCollapsed = true"
                  @expand="leftPanelCollapsed = false"
                >
                  <div class="h-full">
                    <div
                      id="left-sidebar"
                      ref="leftSidebarEl"
                      class="h-full grow overflow-clip"
                    ></div>
                  </div>
                </ResizablePanel>
              </ContextMenuTrigger>
              <ContextMenuContent class="w-46">
                <ContextMenuItem @click="leftPanel?.collapse()">
                  <IconX /> {{ t("tooltips.closePanel") }}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <ResizableHandle
                    class="data-[resize-handle-state=drag]:after:bg-muted-foreground data-[resize-handle-state=hover]:after:bg-muted-foreground data-[resize-handle-state=hover]:bg-muted-foreground data-[resize-handle-state=drag]:bg-muted-foreground focus-visible:after:bg-muted-foreground! z-20 w-0! transition before:pointer-events-auto before:absolute before:inset-y-0 before:left-1/2 before:w-3 before:-translate-x-1/2 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none focus-visible:after:scale-400 data-resize-handle:after:w-px data-[resize-handle-state=drag]:after:scale-400 data-[resize-handle-state=hover]:after:scale-400"
                    :class="{
                      'data-resize-handle:after:bg-muted':
                        !leftPanel?.isCollapsed,
                    }"
                    @dblclick="
                      leftPanel?.isCollapsed
                        ? leftPanel?.expand()
                        : leftPanel?.collapse()
                    "
                  />
                </TooltipTrigger>
                <TooltipContent side="right" class="p-1!">
                  <div class="flex flex-col gap-1">
                    <div class="bg-accent/5 flex flex-col gap-2 p-2">
                      <span class="flex items-center gap-2">
                        <IconHand /> {{ t("tooltips.dragToResize") }}
                      </span>
                      <span class="flex items-center gap-2">
                        <IconPointerClick />
                        {{ t("tooltips.doubleClickToggle") }}
                      </span>
                    </div>
                    <div class="bg-accent/5 flex flex-col gap-2 p-2">
                      <span class="flex items-center gap-2">
                        <IconArrowRight />
                        {{ t("tooltips.rightArrowExpand") }}
                      </span>
                      <span class="flex items-center gap-2">
                        <IconArrowLeft />
                        {{ t("tooltips.leftArrowCollapse") }}
                      </span>
                      <span class="flex items-center gap-2">
                        <IconArrowBigUp />
                        {{ t("tooltips.shiftLargeSteps") }}
                      </span>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <ResizablePanel>
              <ResizablePanelGroup
                :style="{ overflow: 'clip' }"
                class="size-full min-h-0 min-w-0"
                direction="vertical"
                auto-save-id="app-vertical-layout"
              >
                <ContextMenu>
                  <ContextMenuTrigger as-child>
                    <ResizablePanel
                      ref="topPanel"
                      collapsible
                      :min-size="15"
                      :default-size="80"
                      :max-size="100"
                      :collapsed-size="0"
                      as-child
                      :inert="topPanel?.isCollapsed"
                    >
                      <div
                        class="bg-background/80 flex min-h-0 min-w-0 grow flex-col overflow-clip"
                      >
                        <!-- Non-scrollable sub-header with backdrop blur -->
                        <div
                          class="bg-sidebar/95 shadow-muted-foreground/5 mx-2 flex items-center justify-between overflow-clip rounded-b-xl border-x border-b p-2 shadow-xs backdrop-blur-lg"
                        >
                          <SubNavigation />
                          <div
                            id="cta-dock"
                            class="flex shrink-0 items-center justify-end gap-2"
                          ></div>
                        </div>
                        <!-- Scrollable content area -->
                        <OverlayScrollbarsWrapper>
                          <RouterView />
                        </OverlayScrollbarsWrapper>
                      </div>
                    </ResizablePanel>
                  </ContextMenuTrigger>
                  <ContextMenuContent class="w-46">
                    <ContextMenuItem @click="router.go(0)">
                      <IconRefreshCcw /> {{ t("actions.refresh") }}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem @click="router.go(-1)">
                      <IconArrowLeft /> {{ t("actions.goBack") }}
                    </ContextMenuItem>
                    <ContextMenuItem @click="router.go(1)">
                      <IconArrowRight /> {{ t("actions.goForward") }}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <ResizableHandle
                        class="data-[resize-handle-state=drag]:after:bg-muted-foreground data-[resize-handle-state=hover]:after:bg-muted-foreground data-[resize-handle-state=hover]:bg-muted-foreground data-[resize-handle-state=drag]:bg-muted-foreground focus-visible:after:bg-muted-foreground! z-10 h-0! w-full! transition before:pointer-events-auto before:absolute before:inset-x-0 before:top-1/2 before:h-3 before:-translate-y-1/2 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none focus-visible:after:scale-400 data-resize-handle:after:h-px! data-[resize-handle-state=drag]:after:scale-400 data-[resize-handle-state=hover]:after:scale-400"
                        :class="{
                          'data-resize-handle:after:bg-muted':
                            !bottomPanel?.isCollapsed && !topPanel?.isCollapsed,
                        }"
                        @dblclick="
                          bottomPanel?.isCollapsed
                            ? bottomPanel?.expand()
                            : bottomPanel?.collapse()
                        "
                      />
                    </TooltipTrigger>
                    <TooltipContent class="p-1!">
                      <div class="flex flex-col gap-1">
                        <div class="bg-accent/5 flex flex-col gap-2 p-2">
                          <span class="flex items-center gap-2">
                            <IconHand /> {{ t("tooltips.dragToResize") }}
                          </span>
                          <span class="flex items-center gap-2">
                            <IconPointerClick />
                            {{ t("tooltips.doubleClickToggle") }}
                          </span>
                        </div>
                        <div class="bg-accent/5 flex flex-col gap-2 p-2">
                          <span class="flex items-center gap-2">
                            <IconArrowUp />
                            {{ t("tooltips.upArrowExpand") }}
                          </span>
                          <span class="flex items-center gap-2">
                            <IconArrowDown />
                            {{ t("tooltips.downArrowCollapse") }}
                          </span>
                          <span class="flex items-center gap-2">
                            <IconArrowBigUp />
                            {{ t("tooltips.shiftLargeSteps") }}
                          </span>
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
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
                      :inert="bottomPanel?.isCollapsed"
                      @collapse="bottomPanelCollapsed = true"
                      @expand="bottomPanelCollapsed = false"
                    >
                      <Tabs
                        v-model="activeTab"
                        class="size-full min-h-0 min-w-0"
                      >
                        <div class="size-full min-h-0 min-w-0">
                          <div
                            id="bottom-sidebar"
                            class="bg-background flex size-full min-h-0 min-w-0 flex-col overflow-clip overscroll-none"
                          >
                            <div class="flex items-stretch gap-2 p-2">
                              <div
                                class="relative flex min-w-0 grow items-stretch justify-start gap-2"
                              >
                                <TabsList
                                  v-if="source.length > 0"
                                  class="flex h-full min-w-0 items-stretch gap-2 bg-transparent"
                                >
                                  <TabsTrigger
                                    v-for="tab in source"
                                    :key="tab.id"
                                    :value="tab.id"
                                    class="hover:bg-secondary/50 data-[state=inactive]:text-secondary-foreground/50 data-[state=inactive]:bg-secondary/50 group size-full w-60 max-w-60 min-w-0 gap-2 border-0 px-3 pr-1.5!"
                                    :class="{
                                      'min-w-40 transition-all':
                                        tab.id === activeTab,
                                      'bg-secondary! shadow-none!':
                                        tab.id === activeTab,
                                    }"
                                    @click="setActiveTab(tab.id)"
                                  >
                                    <IconTerminal />
                                    <span
                                      class="flex grow items-center justify-start truncate"
                                    >
                                      {{ tab.label }}
                                    </span>
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger as-child>
                                          <InputGroupButton
                                            variant="ghost"
                                            size="icon-xs"
                                            class="invisible group-hover:visible"
                                            @click.stop.prevent="
                                              closeTab(tab.id)
                                            "
                                          >
                                            <IconX />
                                          </InputGroupButton>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          {{ t("layouts.app.tabs.close") }}
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  </TabsTrigger>
                                </TabsList>
                                <div
                                  class="bg-background sticky right-0 z-30 flex shrink-0 items-center"
                                >
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger as-child>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          @click="newTab()"
                                        >
                                          <IconPlus />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {{ t("layouts.app.tabs.new") }}
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </div>
                              </div>
                              <div
                                class="flex shrink-0 items-center justify-end gap-2"
                              >
                                <ButtonGroup>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger as-child>
                                        <Button
                                          variant="secondary"
                                          size="icon"
                                          @click="
                                            topPanel?.isCollapsed
                                              ? topPanel?.expand()
                                              : topPanel?.collapse()
                                          "
                                        >
                                          <IconMinimize
                                            v-if="topPanel?.isCollapsed"
                                          />
                                          <IconMaximize v-else />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {{
                                          topPanel?.isCollapsed
                                            ? t("layouts.app.panel.minimize")
                                            : t("layouts.app.panel.maximize")
                                        }}
                                      </TooltipContent>
                                    </Tooltip>
                                    <ButtonGroupSeparator />
                                    <Tooltip>
                                      <TooltipTrigger as-child>
                                        <Button
                                          variant="secondary"
                                          size="icon"
                                          @click="bottomPanel?.collapse()"
                                        >
                                          <IconX />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {{ t("layouts.app.panel.close") }}
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </ButtonGroup>
                              </div>
                            </div>
                            <OverlayScrollbarsWrapper>
                              <TabsContent
                                v-for="tab in source"
                                :key="tab.id"
                                :value="tab.id"
                                class="size-full"
                              >
                                <Terminal />
                              </TabsContent>
                              <Empty v-if="source.length === 0">
                                <EmptyHeader>
                                  <EmptyMedia variant="icon">
                                    <IconLayers />
                                  </EmptyMedia>
                                  <EmptyTitle>
                                    {{ t("layouts.app.empty.console.title") }}
                                  </EmptyTitle>
                                  <EmptyDescription>
                                    {{
                                      t("layouts.app.empty.console.description")
                                    }}
                                  </EmptyDescription>
                                </EmptyHeader>
                                <EmptyContent>
                                  <Button variant="outline" @click="newTab()">
                                    {{ t("layouts.app.empty.console.action") }}
                                  </Button>
                                </EmptyContent>
                              </Empty>
                            </OverlayScrollbarsWrapper>
                          </div>
                        </div>
                      </Tabs>
                    </ResizablePanel>
                  </ContextMenuTrigger>
                  <ContextMenuContent class="w-46">
                    <ContextMenuItem
                      @click="
                        topPanel?.isCollapsed
                          ? topPanel?.expand()
                          : topPanel?.collapse()
                      "
                    >
                      <IconMinimize v-if="topPanel?.isCollapsed" />
                      <IconMaximize v-else />
                      {{
                        topPanel?.isCollapsed
                          ? t("layouts.app.panel.collapse")
                          : t("layouts.app.panel.expand")
                      }}
                    </ContextMenuItem>
                    <ContextMenuItem @click="bottomPanel?.collapse()">
                      <IconX /> {{ t("layouts.app.panel.close") }}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </ResizablePanelGroup>
            </ResizablePanel>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <ResizableHandle
                    class="data-[resize-handle-state=drag]:after:bg-muted-foreground data-[resize-handle-state=hover]:after:bg-muted-foreground data-[resize-handle-state=hover]:bg-muted-foreground data-[resize-handle-state=drag]:bg-muted-foreground focus-visible:after:bg-muted-foreground! z-20 w-0! transition before:pointer-events-auto before:absolute before:inset-y-0 before:left-1/2 before:w-3 before:-translate-x-1/2 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none focus-visible:after:scale-400 data-resize-handle:after:w-px data-[resize-handle-state=drag]:after:scale-400 data-[resize-handle-state=hover]:after:scale-400"
                    :class="{
                      'data-resize-handle:after:bg-muted':
                        !rightPanel?.isCollapsed,
                    }"
                    @dblclick="
                      rightPanel?.isCollapsed
                        ? rightPanel?.expand()
                        : rightPanel?.collapse()
                    "
                  />
                </TooltipTrigger>
                <TooltipContent side="left" class="p-1!">
                  <div class="flex flex-col gap-1">
                    <div class="bg-accent/5 flex flex-col gap-2 p-2">
                      <span class="flex items-center gap-2">
                        <IconHand /> {{ t("tooltips.dragToResize") }}
                      </span>
                      <span class="flex items-center gap-2">
                        <IconPointerClick />
                        {{ t("tooltips.doubleClickToToggle") }}
                      </span>
                    </div>
                    <div class="bg-accent/5 flex flex-col gap-2 p-2">
                      <span class="flex items-center gap-2">
                        <IconArrowLeft />
                        {{ t("tooltips.leftArrowExpand") }}
                      </span>
                      <span class="flex items-center gap-2">
                        <IconArrowRight />
                        {{ t("tooltips.rightArrowCollapse") }}
                      </span>
                      <span class="flex items-center gap-2">
                        <IconArrowBigUp />
                        {{ t("tooltips.shiftLargeSteps") }}
                      </span>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <ContextMenu>
              <ContextMenuTrigger as-child>
                <ResizablePanel
                  ref="rightPanel"
                  collapsible
                  :min-size="15"
                  :default-size="20"
                  :max-size="25"
                  :collapsed-size="0"
                  as-child
                  :inert="rightPanel?.isCollapsed"
                  @collapse="rightPanelCollapsed = true"
                  @expand="rightPanelCollapsed = false"
                >
                  <div class="h-full">
                    <div
                      id="right-sidebar"
                      ref="rightSidebarEl"
                      class="h-full grow overflow-clip"
                    ></div>
                  </div>
                </ResizablePanel>
              </ContextMenuTrigger>
              <ContextMenuContent class="w-46">
                <ContextMenuItem @click="rightPanel?.collapse()">
                  <IconX /> {{ t("layouts.app.panel.close") }}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </ResizablePanelGroup>
          <Transition
            enter-active-class="transition transform duration-200 ease-in-out"
            leave-active-class="transition transform duration-200 ease-in-out"
            enter-from-class="opacity-0 scale-95"
            leave-to-class="opacity-0 scale-95"
          >
            <div
              v-if="isPoppedOut"
              ref="draggableContainer"
              class="pointer-events-none fixed inset-y-12 right-2 left-14 z-50"
            >
              <ContextMenu>
                <ContextMenuTrigger as-child>
                  <Draggable
                    ref="draggableEl"
                    prevent-default
                    :handle="draggableHandleEl"
                    :initial-value="{
                      x: observedPosition.x * (innerWidth - observedSize.width),
                      y:
                        observedPosition.y *
                        (innerHeight - observedSize.height),
                    }"
                    storage-key="popout-position"
                    storage-type="local"
                    :container-element="draggableContainer"
                    :style="
                      isPoppedOutMinimized
                        ? {
                            width: 'auto',
                            height: 'auto',
                          }
                        : {
                            width: `${observedSize.width}px`,
                            height: `${observedSize.height}px`,
                          }
                    "
                    class="bg-secondary overflow-clipborder pointer-events-auto absolute flex min-w-64 flex-col will-change-transform"
                    :class="
                      isPoppedOutMinimized
                        ? 'border-foreground shadow-md ring-1'
                        : 'min-h-64 resize shadow'
                    "
                  >
                    <div
                      ref="draggableHandleEl"
                      class="flex cursor-move items-center justify-between p-2"
                      :class="
                        isPoppedOutMinimized ? 'bg-sidebar' : 'bg-secondary'
                      "
                      @dblclick="isPoppedOutMinimized = !isPoppedOutMinimized"
                    >
                      <span class="ml-2 flex items-center gap-2 font-medium">
                        <IconGripHorizontal />
                        {{ t("layouts.app.popout.title") }}
                      </span>
                      <ButtonGroup>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger as-child>
                              <InputGroupButton
                                variant="ghost"
                                size="icon-xs"
                                @click="
                                  isPoppedOutMinimized = !isPoppedOutMinimized
                                "
                              >
                                <IconPlus v-if="isPoppedOutMinimized" />
                                <IconMinus v-else />
                              </InputGroupButton>
                            </TooltipTrigger>
                            <TooltipContent>
                              {{
                                isPoppedOutMinimized
                                  ? t("layouts.app.sidebar.expand")
                                  : t("layouts.app.sidebar.minimize")
                              }}
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger as-child>
                              <InputGroupButton
                                variant="ghost"
                                size="icon-xs"
                                @click="isPoppedOut = false"
                              >
                                <IconX />
                              </InputGroupButton>
                            </TooltipTrigger>
                            <TooltipContent>
                              {{ t("layouts.app.sidebar.close") }}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </ButtonGroup>
                    </div>
                    <div
                      v-if="!isPoppedOutMinimized"
                      class="bg-background growborder mx-2 mb-2 p-2"
                    >
                      <div
                        class="size-fullbg-[repeating-linear-gradient(45deg,var(--color-muted)_0,var(--color-muted)_1px,transparent_0,transparent_50%)] bg-size-[8px_8px] p-2"
                      >
                        Sample Content
                      </div>
                    </div>
                  </Draggable>
                </ContextMenuTrigger>
                <ContextMenuContent class="w-46">
                  <ContextMenuItem
                    @click="isPoppedOutMinimized = !isPoppedOutMinimized"
                  >
                    <IconMinus v-if="!isPoppedOutMinimized" />
                    <IconPlus v-else />
                    {{
                      isPoppedOutMinimized
                        ? t("layouts.app.sidebar.expand")
                        : t("layouts.app.sidebar.minimize")
                    }}
                  </ContextMenuItem>
                  <ContextMenuItem @click="isPoppedOut = false">
                    <IconX /> {{ t("layouts.app.sidebar.close") }}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </div>
          </Transition>
          <div
            id="right-dock"
            class="shadow-muted-foreground/5 bg-background flex max-w-80 shrink-0 flex-col overflow-clip rounded-xl border shadow empty:hidden"
          ></div>
        </div>
      </div>
    </ResizablePanel>
  </ResizablePanelGroup>
</template>
