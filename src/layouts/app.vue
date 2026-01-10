<script lang="ts" setup>
import { ResizablePanel } from "@/components/ui/resizable"
import {
  IconArrowBigUp,
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconCloudAlert,
  IconCloudCheck,
  IconCloudSync,
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
import { useTeamStore } from "@/stores/teamStore"
import { listen } from "@tauri-apps/api/event"
import { UseDraggable as Draggable } from "@vueuse/components"
import { storeToRefs } from "pinia"

const teamStore = useTeamStore()
const { currentTeam, isLoading } = storeToRefs(teamStore)

const { t } = useI18n()
const router = useRouter()

const leftPanel = ref<InstanceType<typeof ResizablePanel>>()
const rightPanel = ref<InstanceType<typeof ResizablePanel>>()
const topPanel = ref<InstanceType<typeof ResizablePanel>>()
const bottomPanel = ref<InstanceType<typeof ResizablePanel>>()

onMounted(async () => {
  await listen("tray-action", (event) => {
    console.log("Tray action received:", event.payload)
    if (event.payload === "settings") {
      emitter.emit("Dialog.Settings.Open", "preferences")
    }
  })
})

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

const innerWidth = window.innerWidth
const innerHeight = window.innerHeight
const draggableContainer = ref<HTMLElement | null>(null)
const draggableEl = ref<HTMLElement | null>(null)
const draggableHandleEl = ref<HTMLElement | null>(null)
const isPoppedOut = useLocalStorage("popout-state", false)
const isPoppedOutMinimized = useLocalStorage("popout-minimized-state", false)
const observedSize = useLocalStorage("popout-size", { width: 300, height: 400 })
const observedPosition = useLocalStorage("popout-position", { x: 0.5, y: 0.5 })

const isOnline = useOnline()

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

const isSyncing = ref(false)

setInterval(() => {
  isSyncing.value = Math.random() > 0.5
}, 2000)

const source = ref<{ id: string; label: string }[]>([])

const iconDisplay = ref<"icon" | "text">("icon")

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
  <div
    v-if="isLoading"
    class="bg-secondary flex size-full flex-1 items-center justify-center"
  >
    <Spinner />
  </div>
  <div
    v-else-if="!currentTeam"
    class="bg-secondary flex size-full flex-1 items-center justify-center"
  >
    <TeamSelector />
  </div>
  <SidebarProvider v-else class="min-h-auto">
    <SidebarInset class="bg-transparent">
      <Headerbar />
      <main class="flex grow overflow-auto overscroll-none scroll-smooth">
        <MainSidebar />
        <div id="left-dock" class="flex max-w-80 shrink-0"></div>
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
                :default-size="20"
                :max-size="25"
                :collapsed-size="0"
                as-child
                class="bg-sidebar"
                :class="{
                  'pointer-events-none hidden':
                    leftPanel?.splitterPanel?.isCollapsed,
                }"
                :inert="leftPanel?.splitterPanel?.isCollapsed"
              >
                <div id="left-sidebar" ref="leftSidebarEl"></div>
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
                  class="data-[resize-handle-state=hover]:after:bg-primary data-[resize-handle-state=drag]:after:bg-primary data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary focus-visible:ring-primary focus-visible:bg-primary z-50 transition focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none"
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
          <ResizablePanel>
            <ResizablePanelGroup
              direction="vertical"
              auto-save-id="app-vertical-layout"
            >
              <ContextMenu>
                <ContextMenuTrigger as-child>
                  <ResizablePanel
                    ref="topPanel"
                    class="flex grow flex-col overflow-auto overscroll-none scroll-smooth"
                    collapsible
                    :min-size="15"
                    :default-size="80"
                    :max-size="100"
                    :collapsed-size="0"
                    :class="{
                      'pointer-events-none hidden':
                        topPanel?.splitterPanel?.isCollapsed,
                    }"
                    :inert="topPanel?.splitterPanel?.isCollapsed"
                  >
                    <Tabbar />
                    <SubNavigation />
                    <Separator />
                    <div
                      class="flex grow flex-col overflow-auto overscroll-none scroll-smooth"
                    >
                      <RouterView />
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
                      class="data-[resize-handle-state=hover]:after:bg-primary data-[resize-handle-state=drag]:after:bg-primary data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary focus-visible:ring-primary focus-visible:bg-primary z-40 transition focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none"
                      @dblclick="
                        bottomPanel?.splitterPanel?.isCollapsed
                          ? bottomPanel?.splitterPanel?.expand()
                          : bottomPanel?.splitterPanel?.collapse()
                      "
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top" class="p-1!">
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
                  >
                    <Tabs v-model="activeTab">
                      <div
                        id="bottom-sidebar"
                        class="bg-background flex flex-1 flex-col overflow-hidden overscroll-none"
                        :class="{
                          'pointer-events-none hidden':
                            bottomPanel?.splitterPanel?.isCollapsed,
                        }"
                        :inert="bottomPanel?.splitterPanel?.isCollapsed"
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
                                        @click.stop.prevent="closeTab(tab.id)"
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
                              class="bg-background after:bg-border sticky right-0 z-30 flex shrink-0 items-center"
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
                                          topPanel?.splitterPanel?.isCollapsed
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
                        <Separator />
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
                                {{ t("layouts.app.empty.console.description") }}
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
                    <IconMinimize v-if="topPanel?.splitterPanel?.isCollapsed" />
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
                  class="data-[resize-handle-state=hover]:after:bg-primary data-[resize-handle-state=drag]:after:bg-primary data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary focus-visible:ring-primary focus-visible:bg-primary z-50 transition focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none"
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
                      <IconArrowRight /> {{ t("tooltips.rightArrowCollapse") }}
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
                class="bg-sidebar"
                :class="{
                  'pointer-events-none hidden':
                    rightPanel?.splitterPanel?.isCollapsed,
                }"
                :inert="rightPanel?.splitterPanel?.isCollapsed"
              >
                <div id="right-sidebar" ref="rightSidebarEl"></div>
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
            class="pointer-events-none fixed top-15 right-2 bottom-10 left-14 z-50"
          >
            <ContextMenu>
              <ContextMenuTrigger as-child>
                <Draggable
                  ref="draggableEl"
                  prevent-default
                  :handle="draggableHandleEl"
                  :initial-value="{
                    x: observedPosition.x * (innerWidth - observedSize.width),
                    y: observedPosition.y * (innerHeight - observedSize.height),
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
                  class="bg-sidebar-accent pointer-events-auto absolute flex min-w-64 flex-col overflow-hidden rounded-md border will-change-transform"
                  :class="
                    isPoppedOutMinimized
                      ? 'border-foreground shadow-md ring-1'
                      : 'min-h-64 resize shadow-lg'
                  "
                >
                  <div
                    ref="draggableHandleEl"
                    class="flex cursor-move items-center justify-between p-1.5"
                    :class="
                      isPoppedOutMinimized ? 'bg-sidebar' : 'bg-sidebar-accent'
                    "
                    @dblclick="isPoppedOutMinimized = !isPoppedOutMinimized"
                  >
                    <span class="ml-1 font-medium">{{
                      t("layouts.app.popout.title")
                    }}</span>
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
                    class="bg-background mx-1.5 mb-1.5 grow rounded border p-2"
                  ></div>
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
      <ContextMenu>
        <ContextMenuTrigger as-child>
          <div
            data-tauri-drag-region
            class="pb-safe-bottom shadow-border bg-sidebar relative z-20 grid shrink-0 grid-cols-3 gap-2 shadow-[0px_-1px]"
          >
            <div class="flex items-center justify-start" data-tauri-drag-region>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button variant="ghost" size="sm" class="rounded-none">
                      <IconCloudAlert v-if="!isOnline" />
                      <IconCloudSync v-else-if="isSyncing" />
                      <IconCloudCheck v-else />
                      <template v-if="iconDisplay === 'text'">
                        {{ t("layouts.app.statusBar.sync") }}
                      </template>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <template v-if="!isOnline">
                      {{ t("layouts.app.status.offline") }}
                    </template>
                    <template v-else-if="isSyncing">
                      {{ t("layouts.app.status.syncing") }}
                    </template>
                    <template v-else>
                      {{ t("layouts.app.status.synced") }}
                    </template>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="rounded-none"
                      @click="
                        bottomPanel?.splitterPanel?.isCollapsed
                          ? bottomPanel?.splitterPanel?.expand()
                          : bottomPanel?.splitterPanel?.collapse()
                      "
                    >
                      <IconTerminal />
                      <template v-if="iconDisplay === 'text'">
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
                      @click="isPoppedOut = !isPoppedOut"
                    >
                      <IconPictureInPicture2 v-if="!isPoppedOut" />
                      <IconPictureInPicture v-else />
                      <template v-if="iconDisplay === 'text'">
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
                      size="sm"
                      class="rounded-none"
                      @click="emitter.emit('Sidebar.Left.Toggle')"
                    >
                      <IconPanelLeft
                        v-if="leftPanel?.splitterPanel?.isCollapsed"
                      />
                      <IconPanelLeftClose v-else />
                      <template v-if="iconDisplay === 'text'">
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
                      size="sm"
                      class="rounded-none"
                      @click="emitter.emit('Panel.Bottom.Toggle')"
                    >
                      <IconPanelBottom
                        v-if="bottomPanel?.splitterPanel?.isCollapsed"
                      />
                      <IconPanelBottomClose v-else />
                      <template v-if="iconDisplay === 'text'">
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
                      size="sm"
                      class="rounded-none"
                      @click="emitter.emit('Sidebar.Right.Toggle')"
                    >
                      <IconPanelRight
                        v-if="rightPanel?.splitterPanel?.isCollapsed"
                      />
                      <IconPanelRightClose v-else />
                      <template v-if="iconDisplay === 'text'">
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
        </ContextMenuTrigger>
        <ContextMenuContent align="start" side="bottom">
          <ContextMenuLabel class="text-muted-foreground text-xs">
            {{ t("layouts.app.statusBar.appearance") }}
          </ContextMenuLabel>
          <ContextMenuRadioGroup v-model="iconDisplay">
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
