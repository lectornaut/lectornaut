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
import { UseDraggable as Draggable } from "@vueuse/components"

import { listen } from "@tauri-apps/api/event"

const { locale } = useI18n()
watch(locale, (newLocale) => localStorage.setItem("locale", newLocale))

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
  <SidebarProvider :default-open="false" class="min-h-auto">
    <SidebarInset class="bg-transparent">
      <Headerbar />
      <main class="flex grow overflow-auto overscroll-none scroll-smooth">
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
                :default-size="20"
                :max-size="25"
                :collapsed-size="0"
                as-child
                class="bg-sidebar"
              >
                <div id="left-sidebar" ref="leftSidebarEl"></div>
              </ResizablePanel>
            </ContextMenuTrigger>
            <ContextMenuContent align="start" side="bottom">
              <ContextMenuItem @click="leftPanel?.splitterPanel?.collapse()">
                <IconX /> Close panel
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
                      <IconHand /> Drag to resize
                    </span>
                    <span class="flex items-center gap-2">
                      <IconPointerClick /> Double click to toggle
                    </span>
                  </div>
                  <div class="bg-accent/5 flex flex-col gap-2 rounded p-2">
                    <span class="flex items-center gap-2">
                      <IconArrowRight /> Right arrow to expand
                    </span>
                    <span class="flex items-center gap-2">
                      <IconArrowLeft /> Left arrow to collapse
                    </span>
                    <span class="flex items-center gap-2">
                      <IconArrowBigUp /> Shift for large steps
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
                    <IconRefreshCcw /> Refresh
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem @click="router.go(-1)">
                    <IconArrowLeft /> Go back
                  </ContextMenuItem>
                  <ContextMenuItem @click="router.go(1)">
                    <IconArrowRight /> Go forward
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
                          <IconHand /> Drag to resize
                        </span>
                        <span class="flex items-center gap-2">
                          <IconPointerClick /> Double click to toggle
                        </span>
                      </div>
                      <div class="bg-accent/5 flex flex-col gap-2 rounded p-2">
                        <span class="flex items-center gap-2">
                          <IconArrowUp /> Up arrow to expand
                        </span>
                        <span class="flex items-center gap-2">
                          <IconArrowDown /> Down arrow to collapse
                        </span>
                        <span class="flex items-center gap-2">
                          <IconArrowBigUp /> Shift for large steps
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
                        class="bg-background flex flex-1 flex-col overflow-auto overscroll-none scroll-smooth"
                      >
                        <div class="flex shrink-0">
                          <div
                            class="no-scrollbar flex flex-1 items-center justify-start overflow-auto overscroll-none scroll-smooth"
                          >
                            <TabsList class="bg-transparent p-0">
                              <TabsTrigger
                                v-for="tab in source"
                                :key="tab.id"
                                class="data-[resize-handle-state=active]:text-foreground hover:text-accent-foreground text-muted-foreground relative h-full rounded-none text-xs uppercase data-[resize-handle-state=active]:border-transparent! data-[resize-handle-state=active]:bg-transparent! data-[resize-handle-state=active]:shadow-none"
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
                                        <IconX class="size-3!" />
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
                                      <IconPlus />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent> New tab </TooltipContent>
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
                                    @click="
                                      bottomPanel?.splitterPanel?.collapse()
                                    "
                                  >
                                    <IconX />
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
                          <Empty v-if="source.length === 0">
                            <EmptyHeader>
                              <EmptyMedia variant="icon">
                                <IconLayerFill
                                  class="text-muted-foreground h-6 w-6"
                                />
                              </EmptyMedia>
                              <EmptyTitle> Console </EmptyTitle>
                              <EmptyDescription>
                                No active terminal sessions. Create a new
                                terminal to get started.
                              </EmptyDescription>
                            </EmptyHeader>
                            <EmptyContent>
                              <Button variant="outline" @click="newTab()">
                                New Terminal
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
                        ? "Collapse panel"
                        : "Expand panel"
                    }}
                  </ContextMenuItem>
                  <ContextMenuItem
                    @click="bottomPanel?.splitterPanel?.collapse()"
                  >
                    <IconX /> Close panel
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
                      <IconHand /> Drag to resize
                    </span>
                    <span class="flex items-center gap-2">
                      <IconPointerClick /> Double click to toggle
                    </span>
                  </div>
                  <div class="bg-accent/5 flex flex-col gap-2 rounded p-2">
                    <span class="flex items-center gap-2">
                      <IconArrowLeft /> Left arrow to expand
                    </span>
                    <span class="flex items-center gap-2">
                      <IconArrowRight /> Right arrow to collapse
                    </span>
                    <span class="flex items-center gap-2">
                      <IconArrowBigUp /> Shift for large steps
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
              >
                <div id="right-sidebar" ref="rightSidebarEl"></div>
              </ResizablePanel>
            </ContextMenuTrigger>
            <ContextMenuContent align="start" side="bottom">
              <ContextMenuItem @click="rightPanel?.splitterPanel?.collapse()">
                <IconX /> Close panel
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
                    <span class="ml-1 font-medium">Popout</span>
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
                                ? "Expand sidebar"
                                : "Minimize sidebar"
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
                          <TooltipContent> Close sidebar </TooltipContent>
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
                    isPoppedOutMinimized ? "Expand sidebar" : "Minimize sidebar"
                  }}
                </ContextMenuItem>
                <ContextMenuItem @click="isPoppedOut = false">
                  <IconX /> Close sidebar
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </div>
        </Transition>
        <div id="right-dock"></div>
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
                    <Button
                      variant="ghost"
                      size="sm"
                      class="w-[calc(var(--sidebar-width-icon))] rounded-none"
                    >
                      <IconCloudAlert v-if="!isOnline" />
                      <IconCloudSync v-else-if="isSyncing" />
                      <IconCloudCheck v-else />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <template v-if="!isOnline"> You are offline </template>
                    <template v-else-if="isSyncing"> Syncing... </template>
                    <template v-else> Synced to cloud </template>
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
                        Console
                      </template>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{
                      bottomPanel?.splitterPanel?.isCollapsed
                        ? "Expand"
                        : "Collapse"
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
                        {{ isPoppedOut ? "Dock" : "Pop out" }}
                      </template>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{ isPoppedOut ? "Dock" : "Pop out" }}
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
                        Sidebar
                      </template>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{
                      leftPanel?.splitterPanel?.isCollapsed
                        ? "Expand"
                        : "Collapse"
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
                      <template v-if="iconDisplay === 'text'"> Panel </template>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{
                      bottomPanel?.splitterPanel?.isCollapsed
                        ? "Expand"
                        : "Collapse"
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
                        Sidebar
                      </template>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{
                      rightPanel?.splitterPanel?.isCollapsed
                        ? "Expand"
                        : "Collapse"
                    }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent align="start" side="bottom">
          <ContextMenuLabel class="text-muted-foreground text-xs">
            Appearance
          </ContextMenuLabel>
          <ContextMenuRadioGroup v-model="iconDisplay">
            <ContextMenuRadioItem value="icon">
              Icons only
            </ContextMenuRadioItem>
            <ContextMenuRadioItem value="text">
              Icons and text
            </ContextMenuRadioItem>
          </ContextMenuRadioGroup>
        </ContextMenuContent>
      </ContextMenu>
    </SidebarInset>
  </SidebarProvider>
</template>
