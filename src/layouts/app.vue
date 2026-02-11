<script lang="ts" setup>
import { ResizablePanel } from "@/components/ui/resizable"
import { isTauri } from "@/composables/usePlatform"
import {
  IconArrowBigUp,
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconCode,
  IconHand,
  IconLayerFill,
  IconMaximize,
  IconMinimize,
  IconMinus,
  IconPanelBottom,
  IconPanelBottomClose,
  IconPanelLeft,
  IconPanelLeftClose,
  IconPanelRight,
  IconPanelRightClose,
  IconPictureInPicture,
  IconPictureInPicture2,
  IconPlus,
  IconPointerClick,
  IconRefreshCcw,
  IconTerminal,
  IconX,
} from "@/data/icons"
import { generateId } from "@/helpers/utilities"
import { emitter } from "@/modules/mitt"
import { useLayoutStore } from "@/stores/layoutStore"
import { useTeamStore } from "@/stores/teamStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { listen } from "@tauri-apps/api/event"
import { UseDraggable as Draggable } from "@vueuse/components"
import { storeToRefs } from "pinia"

const teamStore = useTeamStore()
const { currentTeam, isLoading } = storeToRefs(teamStore)

const workspaceStore = useWorkspaceStore()
const { currentWorkspace } = storeToRefs(workspaceStore)
const layoutStore = useLayoutStore()
const {
  footerIconDisplay,
  sidebarOpen,
  leftPanelCollapsed,
  rightPanelCollapsed,
  bottomPanelCollapsed,
} = storeToRefs(layoutStore)

const { t } = useI18n()
const router = useRouter()

const leftPanel = ref<InstanceType<typeof ResizablePanel>>()
const rightPanel = ref<InstanceType<typeof ResizablePanel>>()
const topPanel = ref<InstanceType<typeof ResizablePanel>>()
const bottomPanel = ref<InstanceType<typeof ResizablePanel>>()

const syncPanelCollapsed = (
  panel: InstanceType<typeof ResizablePanel> | undefined,
  collapsed: boolean
) => {
  const splitterPanel = panel?.splitterPanel
  if (!splitterPanel) return
  if (collapsed && !splitterPanel.isCollapsed) {
    splitterPanel.collapse()
  } else if (!collapsed && splitterPanel.isCollapsed) {
    splitterPanel.expand()
  }
}

const applyPersistedPanelState = () => {
  syncPanelCollapsed(leftPanel.value, leftPanelCollapsed.value)
  syncPanelCollapsed(rightPanel.value, rightPanelCollapsed.value)
  syncPanelCollapsed(bottomPanel.value, bottomPanelCollapsed.value)
}

onMounted(async () => {
  await nextTick()
  applyPersistedPanelState()

  if (isTauri.value) {
    await listen("tray-action", (event) => {
      console.log("Tray action received:", event.payload)
      if (event.payload === "settings") {
        emitter.emit("Dialog.Settings.Open", "preferences")
      }
    })
  }
})

watch([leftPanelCollapsed, rightPanelCollapsed, bottomPanelCollapsed], () => {
  void nextTick(() => {
    applyPersistedPanelState()
  })
})

emitter.on("Sidebar.Left.Toggle", () => {
  if (leftPanel.value?.splitterPanel?.isCollapsed) {
    leftPanel.value?.splitterPanel?.expand()
  } else {
    leftPanel.value?.splitterPanel?.collapse()
  }
})

emitter.on("Sidebar.Left.Collapse", () => {
  if (!leftPanel.value?.splitterPanel?.isCollapsed) {
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

emitter.on("Sidebar.Right.Collapse", () => {
  if (!rightPanel.value?.splitterPanel?.isCollapsed) {
    rightPanel.value?.splitterPanel?.collapse()
  }
})

emitter.on("Sidebar.Left.Expand", () => {
  if (leftPanel.value?.splitterPanel?.isCollapsed) {
    leftPanel.value?.splitterPanel?.expand()
  }
})

emitter.on("Sidebar.Right.Expand", () => {
  if (rightPanel.value?.splitterPanel?.isCollapsed) {
    rightPanel.value?.splitterPanel?.expand()
  }
})

emitter.on("Panel.Bottom.Toggle", () => {
  if (bottomPanel.value?.splitterPanel?.isCollapsed) {
    bottomPanel.value?.splitterPanel?.expand()
  } else {
    bottomPanel.value?.splitterPanel?.collapse()
  }
})

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
  <SidebarProvider v-model:open="sidebarOpen">
    <SidebarInset class="bg-transparent">
      <Headerbar />
      <div data-tauri-drag-region class="grid min-h-0 min-w-0 grow">
        <Spinner v-if="isLoading" class="m-auto" />
        <TeamSelector v-else-if="!currentTeam" />
        <WorkspaceSelector v-else-if="!currentWorkspace" />
        <main
          v-else
          class="flex min-h-0 min-w-0 grow gap-2 self-stretch overflow-hidden overscroll-none scroll-smooth"
        >
          <MainSidebar />
          <div id="left-dock" class="flex max-w-80 shrink-0 empty:hidden"></div>
          <ResizablePanelGroup
            class="min-w-0 overflow-clip rounded-2xl border"
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
                  class="transition-all"
                  :inert="leftPanel?.splitterPanel?.isCollapsed"
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
              <ContextMenuContent align="start" side="bottom">
                <ContextMenuItem @click="leftPanel?.splitterPanel?.collapse()">
                  <IconX /> {{ t("tooltips.closePanel") }}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <ResizableHandle
                    class="data-[resize-handle-state=hover]:after:bg-primary data-[resize-handle-state=drag]:after:bg-primary data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary focus-visible:ring-sidebar-accent focus-visible:bg-primary z-20 w-0! bg-transparent transition focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none data-resize-handle:after:w-px"
                    :class="{
                      'data-resize-handle:after:bg-border':
                        !leftPanel?.splitterPanel?.isCollapsed,
                    }"
                    @dblclick="
                      leftPanel?.splitterPanel?.isCollapsed
                        ? leftPanel?.splitterPanel?.expand()
                        : leftPanel?.splitterPanel?.collapse()
                    "
                  />
                </TooltipTrigger>
                <TooltipContent side="right" class="p-1!">
                  <div class="flex flex-col gap-1">
                    <div class="bg-accent/5 flex flex-col gap-2 rounded p-2">
                      <span class="flex items-center gap-2">
                        <IconHand /> {{ t("tooltips.dragToResize") }}
                      </span>
                      <span class="flex items-center gap-2">
                        <IconPointerClick />
                        {{ t("tooltips.doubleClickToggle") }}
                      </span>
                    </div>
                    <div class="bg-accent/5 flex flex-col gap-2 rounded p-2">
                      <span class="flex items-center gap-2">
                        <IconArrowRight /> {{ t("tooltips.rightArrowExpand") }}
                      </span>
                      <span class="flex items-center gap-2">
                        <IconArrowLeft /> {{ t("tooltips.leftArrowCollapse") }}
                      </span>
                      <span class="flex items-center gap-2">
                        <IconArrowBigUp /> {{ t("tooltips.shiftLargeSteps") }}
                      </span>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <ResizablePanel :class="'transition-all'">
              <ResizablePanelGroup
                class="min-w-0 overflow-clip"
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
                      class="transition-all"
                      :inert="topPanel?.splitterPanel?.isCollapsed"
                    >
                      <div class="flex min-h-0 flex-1 flex-col gap-2">
                        <div
                          class="bg-background flex min-h-0 flex-1 flex-col overflow-clip"
                        >
                          <!-- Non-scrollable header -->
                          <div class="flex shrink-0 flex-col">
                            <Tabbar />
                            <Separator />
                          </div>
                          <!-- Scrollable content area - isolate scroll context -->
                          <div
                            class="relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-none scroll-smooth [scrollbar-gutter:stable]"
                          >
                            <div
                              class="bg-sidebar/95 sticky top-0 z-20 mx-2 flex shrink-0 items-center justify-between overflow-hidden rounded-b-2xl border-x border-b p-1.5 shadow-xs backdrop-blur-lg"
                            >
                              <SubNavigation />
                              <div
                                id="cta-dock"
                                class="flex shrink-0 items-center justify-end gap-2 empty:hidden"
                              ></div>
                            </div>
                            <RouterView />
                          </div>
                        </div>
                      </div>
                    </ResizablePanel>
                  </ContextMenuTrigger>
                  <ContextMenuContent align="start" side="bottom">
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
                        class="data-[resize-handle-state=hover]:after:bg-primary data-[resize-handle-state=drag]:after:bg-primary data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary focus-visible:ring-sidebar-accent focus-visible:bg-primary z-10 h-0! w-auto! bg-transparent transition focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none data-resize-handle:after:h-px!"
                        :class="{
                          'data-resize-handle:after:bg-border':
                            !bottomPanel?.splitterPanel?.isCollapsed &&
                            !topPanel?.splitterPanel?.isCollapsed,
                        }"
                        @dblclick="
                          bottomPanel?.splitterPanel?.isCollapsed
                            ? bottomPanel?.splitterPanel?.expand()
                            : bottomPanel?.splitterPanel?.collapse()
                        "
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" class="p-1!">
                      <div class="flex flex-col gap-1">
                        <div
                          class="bg-accent/5 flex flex-col gap-2 rounded p-2"
                        >
                          <span class="flex items-center gap-2">
                            <IconHand /> {{ t("tooltips.dragToResize") }}
                          </span>
                          <span class="flex items-center gap-2">
                            <IconPointerClick />
                            {{ t("tooltips.doubleClickToggle") }}
                          </span>
                        </div>
                        <div
                          class="bg-accent/5 flex flex-col gap-2 rounded p-2"
                        >
                          <span class="flex items-center gap-2">
                            <IconArrowUp /> {{ t("tooltips.upArrowExpand") }}
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
                      class="transition-all"
                      :inert="bottomPanel?.splitterPanel?.isCollapsed"
                      @collapse="bottomPanelCollapsed = true"
                      @expand="bottomPanelCollapsed = false"
                    >
                      <Tabs v-model="activeTab">
                        <div class="h-full">
                          <div
                            id="bottom-sidebar"
                            class="bg-background flex h-full flex-col overflow-clip overscroll-none"
                          >
                            <div
                              class="flex items-stretch gap-2 p-2 transition-all"
                            >
                              <div
                                class="relative flex min-w-0 flex-1 items-stretch justify-start gap-2"
                              >
                                <TabsList
                                  v-if="source.length > 0"
                                  class="flex h-full min-w-0 items-stretch gap-2 bg-transparent p-0"
                                >
                                  <TabsTrigger
                                    v-for="tab in source"
                                    :key="tab.id"
                                    :value="tab.id"
                                    class="hover:bg-secondary/50 size-full w-60 max-w-60 min-w-0 gap-2 border-0 px-3"
                                    :class="{
                                      'min-w-40 transition-all':
                                        tab.id === activeTab,
                                      'bg-secondary! shadow-none!':
                                        tab.id === activeTab,
                                    }"
                                    @click="setActiveTab(tab.id)"
                                  >
                                    <IconCode />
                                    <span
                                      class="flex-1 items-center justify-start truncate text-left"
                                    >
                                      {{ tab.label }}
                                    </span>
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger as-child>
                                          <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            class="size-4 shrink-0"
                                            @click.stop.prevent="
                                              closeTab(tab.id)
                                            "
                                          >
                                            <IconX class="size-3!" />
                                          </Button>
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
                                          size="icon-sm"
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
                                          size="icon-sm"
                                          @click="
                                            topPanel?.splitterPanel?.isCollapsed
                                              ? topPanel?.splitterPanel?.expand()
                                              : topPanel?.splitterPanel?.collapse()
                                          "
                                        >
                                          <IconMinimize
                                            v-if="
                                              topPanel?.splitterPanel
                                                ?.isCollapsed
                                            "
                                          />
                                          <IconMaximize v-else />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {{
                                          topPanel?.splitterPanel?.isCollapsed
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
                                          size="icon-sm"
                                          @click="
                                            bottomPanel?.splitterPanel?.collapse()
                                          "
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
                                    <IconLayerFill
                                      class="text-muted-foreground size-6"
                                    />
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
                  <ContextMenuContent align="start" side="bottom">
                    <ContextMenuItem
                      @click="
                        topPanel?.splitterPanel?.isCollapsed
                          ? topPanel?.splitterPanel?.expand()
                          : topPanel?.splitterPanel?.collapse()
                      "
                    >
                      <IconMinimize
                        v-if="topPanel?.splitterPanel?.isCollapsed"
                      />
                      <IconMaximize v-else />
                      {{
                        topPanel?.splitterPanel?.isCollapsed
                          ? t("layouts.app.panel.collapse")
                          : t("layouts.app.panel.expand")
                      }}
                    </ContextMenuItem>
                    <ContextMenuItem
                      @click="bottomPanel?.splitterPanel?.collapse()"
                    >
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
                    class="data-[resize-handle-state=hover]:after:bg-primary data-[resize-handle-state=drag]:after:bg-primary data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary focus-visible:ring-sidebar-accent focus-visible:bg-primary z-20 w-0! bg-transparent transition focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none data-resize-handle:after:w-px"
                    :class="{
                      'data-resize-handle:after:bg-border':
                        !rightPanel?.splitterPanel?.isCollapsed,
                    }"
                    @dblclick="
                      rightPanel?.splitterPanel?.isCollapsed
                        ? rightPanel?.splitterPanel?.expand()
                        : rightPanel?.splitterPanel?.collapse()
                    "
                  />
                </TooltipTrigger>
                <TooltipContent side="left" class="p-1!">
                  <div class="flex flex-col gap-1">
                    <div class="bg-accent/5 flex flex-col gap-2 rounded p-2">
                      <span class="flex items-center gap-2">
                        <IconHand /> {{ t("tooltips.dragToResize") }}
                      </span>
                      <span class="flex items-center gap-2">
                        <IconPointerClick />
                        {{ t("tooltips.doubleClickToToggle") }}
                      </span>
                    </div>
                    <div class="bg-accent/5 flex flex-col gap-2 rounded p-2">
                      <span class="flex items-center gap-2">
                        <IconArrowLeft /> {{ t("tooltips.leftArrowExpand") }}
                      </span>
                      <span class="flex items-center gap-2">
                        <IconArrowRight />
                        {{ t("tooltips.rightArrowCollapse") }}
                      </span>
                      <span class="flex items-center gap-2">
                        <IconArrowBigUp /> {{ t("tooltips.shiftLargeSteps") }}
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
                  class="transition-all"
                  :inert="rightPanel?.splitterPanel?.isCollapsed"
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
              <ContextMenuContent align="start" side="bottom">
                <ContextMenuItem @click="rightPanel?.splitterPanel?.collapse()">
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
                    class="bg-secondary pointer-events-auto absolute flex min-w-64 flex-col overflow-hidden rounded-md border will-change-transform"
                    :class="
                      isPoppedOutMinimized
                        ? 'border-foreground shadow-md ring-1'
                        : 'min-h-64 resize shadow-lg'
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
                      <span class="ml-1 font-medium">
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
                      class="bg-background mx-2 mb-2 grow rounded border p-2"
                    >
                      <div
                        class="size-full bg-[repeating-linear-gradient(45deg,var(--muted)_0,var(--muted)_1px,transparent_0,transparent_50%)] bg-size-[8px_8px]"
                      >
                        Sample Content
                      </div>
                    </div>
                  </Draggable>
                </ContextMenuTrigger>
                <ContextMenuContent align="start" side="bottom">
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
          <div id="right-dock" class="flex max-w-80 shrink-0"></div>
        </main>
      </div>
      <ContextMenu>
        <ContextMenuTrigger as-child>
          <footer class="pb-safe-bottom">
            <div
              data-tauri-drag-region
              class="relative z-20 grid shrink-0 grid-cols-3 gap-2 p-2"
            >
              <div
                data-tauri-drag-region
                class="flex items-center justify-start gap-2"
              >
                <TooltipProvider>
                  <SyncIndicator :icon-display="footerIconDisplay" />
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        variant="ghost"
                        :size="footerIconDisplay === 'text' ? 'sm' : 'icon-sm'"
                        @click="
                          bottomPanel?.splitterPanel?.isCollapsed
                            ? bottomPanel?.splitterPanel?.expand()
                            : bottomPanel?.splitterPanel?.collapse()
                        "
                      >
                        <IconTerminal />
                        <template v-if="footerIconDisplay === 'text'">
                          {{ t("layouts.app.statusBar.console") }}
                        </template>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{
                        bottomPanel?.splitterPanel?.isCollapsed
                          ? t("actions.expand")
                          : t("actions.collapse")
                      }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div
                data-tauri-drag-region
                class="flex items-center justify-center gap-2"
              ></div>
              <div
                data-tauri-drag-region
                class="flex items-center justify-end gap-2"
              >
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        variant="ghost"
                        :size="footerIconDisplay === 'text' ? 'sm' : 'icon-sm'"
                        @click="isPoppedOut = !isPoppedOut"
                      >
                        <IconPictureInPicture2 v-if="!isPoppedOut" />
                        <IconPictureInPicture v-else />
                        <template v-if="footerIconDisplay === 'text'">
                          {{
                            isPoppedOut
                              ? t("layouts.app.statusBar.dock")
                              : t("layouts.app.statusBar.popOut")
                          }}
                        </template>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{
                        isPoppedOut
                          ? t("layouts.app.statusBar.dock")
                          : t("layouts.app.statusBar.popOut")
                      }}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        variant="ghost"
                        :size="footerIconDisplay === 'text' ? 'sm' : 'icon-sm'"
                        @click="emitter.emit('Sidebar.Left.Toggle')"
                      >
                        <IconPanelLeft
                          v-if="leftPanel?.splitterPanel?.isCollapsed"
                        />
                        <IconPanelLeftClose v-else />
                        <template v-if="footerIconDisplay === 'text'">
                          {{ t("layouts.app.statusBar.sidebar") }}
                        </template>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{
                        leftPanel?.splitterPanel?.isCollapsed
                          ? t("actions.expand")
                          : t("actions.collapse")
                      }}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        variant="ghost"
                        :size="footerIconDisplay === 'text' ? 'sm' : 'icon-sm'"
                        @click="emitter.emit('Panel.Bottom.Toggle')"
                      >
                        <IconPanelBottom
                          v-if="bottomPanel?.splitterPanel?.isCollapsed"
                        />
                        <IconPanelBottomClose v-else />
                        <template v-if="footerIconDisplay === 'text'">
                          {{ t("layouts.app.statusBar.panel") }}
                        </template>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{
                        bottomPanel?.splitterPanel?.isCollapsed
                          ? t("actions.expand")
                          : t("actions.collapse")
                      }}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        variant="ghost"
                        :size="footerIconDisplay === 'text' ? 'sm' : 'icon-sm'"
                        @click="emitter.emit('Sidebar.Right.Toggle')"
                      >
                        <IconPanelRight
                          v-if="rightPanel?.splitterPanel?.isCollapsed"
                        />
                        <IconPanelRightClose v-else />
                        <template v-if="footerIconDisplay === 'text'">
                          {{ t("layouts.app.statusBar.sidebar") }}
                        </template>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{
                        rightPanel?.splitterPanel?.isCollapsed
                          ? t("actions.expand")
                          : t("actions.collapse")
                      }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </footer>
        </ContextMenuTrigger>
        <ContextMenuContent align="start" side="bottom">
          <ContextMenuLabel class="text-muted-foreground text-xs">
            {{ t("layouts.app.statusBar.appearance") }}
          </ContextMenuLabel>
          <ContextMenuRadioGroup v-model="footerIconDisplay">
            <ContextMenuRadioItem value="icon">
              {{ t("layouts.app.statusBar.iconsOnly") }}
            </ContextMenuRadioItem>
            <ContextMenuRadioItem value="text">
              {{ t("layouts.app.statusBar.iconsAndText") }}
            </ContextMenuRadioItem>
          </ContextMenuRadioGroup>
        </ContextMenuContent>
      </ContextMenu>
    </SidebarInset>
  </SidebarProvider>
</template>
