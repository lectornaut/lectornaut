<script setup lang="ts">
import { ResizablePanel } from "@/components/ui/resizable"
import emitter from "@/modules/mitt"
import { state } from "@/modules/theme"
import { useResizeObserver } from "@vueuse/core"
import { ClipboardAddon } from "@xterm/addon-clipboard"
import { FitAddon } from "@xterm/addon-fit"
import { LigaturesAddon } from "@xterm/addon-ligatures"
import { Unicode11Addon } from "@xterm/addon-unicode11"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"

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

const source = ref([
  {
    id: 1,
    label: "Tab 1",
  },
  {
    id: 2,
    label: "Tab 2",
  },
  {
    id: 3,
    label: "Tab 3",
  },
])

const iconDisplay = ref<"icon" | "text">("icon")

const activeTab = ref<string>("tab-1")

const bottomSidebarEl = ref<HTMLElement | null>(null)
const terminalEl = ref<HTMLElement | null>(null)

const fitAddon = new FitAddon()
const clipboardAddon = new ClipboardAddon()
const ligaturesAddon = new LigaturesAddon()
const webLinksAddon = new WebLinksAddon()
const unicode11Addon = new Unicode11Addon()

const term = new Terminal({
  fontFamily: "var(--font-mono)",
  convertEol: true,
  cursorBlink: true,
  allowProposedApi: true,
  fontSize: 14,
  fontWeight: "normal",
  fontWeightBold: "bold",
  letterSpacing: 0,
  wordSeparator: `~!@#$%^&*()-=+[{]}\\|;:'",.<>/?`,
  lineHeight: 1.4,
  cursorWidth: 4,
  cursorStyle: "underline",
  cursorInactiveStyle: "outline",
  tabStopWidth: 4,
})

const applyTerminalTheme = (mode: string) => {
  const light = {
    background: "oklch(97% 0.001 106.424)",
    foreground: "oklch(26.8% 0.007 34.298)",
    cursor: "oklch(26.8% 0.007 34.298)",
    cursorAccent: "oklch(92.3% 0.003 48.717)",
    selectionBackground: "oklch(92.3% 0.003 48.717)",
    selectionForeground: "oklch(21.6% 0.006 56.043)",
    selectionInactiveBackground: "oklch(92.3% 0.003 48.717)",
  }
  const dark = {
    background: "oklch(14.1% 0.005 285.823)",
    foreground: "oklch(92% 0.004 286.32)",
    cursor: "oklch(92% 0.004 286.32)",
    cursorAccent: "oklch(27.4% 0.006 286.033)",
    selectionBackground: "oklch(27.4% 0.006 286.033)",
    selectionForeground: "oklch(70.5% 0.015 286.067)",
    selectionInactiveBackground: "oklch(27.4% 0.006 286.033)",
  }
  term.options.theme = mode === "light" ? light : dark
}

applyTerminalTheme(state.value)

watch(
  () => state.value,
  (mode) => {
    applyTerminalTheme(mode)
  }
)

const promptPrefix = "> "
let line = ""

// Initial prompt
term.write(promptPrefix)

onMounted(async () => {
  term.open(terminalEl.value!)
  term.loadAddon(fitAddon)
  fitAddon.fit()
  term.loadAddon(clipboardAddon)
  term.loadAddon(ligaturesAddon)
  term.loadAddon(webLinksAddon)
  term.loadAddon(unicode11Addon)
  term.unicode.activeVersion = "11"
  term.onData((e) => {
    const code = e.charCodeAt(0)

    // If the user presses Enter (code 13)
    if (code === 13) {
      // Process the command and print a response
      term.write("\r\n") // Add a newline

      // Clear the current line buffer and display a new prompt
      line = ""
      term.write(promptPrefix)
    } else if (code === 127) {
      // If the user presses backspace (code 127)
      // Don't delete the prompt itself
      if (line.length > 0) {
        term.write("\b \b") // Erase character from the screen
        line = line.slice(0, -1) // Remove character from your line buffer
      }
    } else {
      // Add the character to your line buffer
      line += e
      term.write(e) // Echo the character back to the terminal
    }
  })

  useResizeObserver(bottomSidebarEl, () => {
    console.log("Bottom panel resized")
    fitAddon.fit()
  })
})

onBeforeUnmount(() => {
  term?.dispose()
})

const newTab = () => {
  const id = source.value.length + 1
  source.value.push({ id, label: `Tab ${id}` })
  activeTab.value = `tab-${id}`
}

const setActiveTab = (tab: string) => {
  activeTab.value = tab
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
                    ref="bottomSidebarEl"
                    class="bg-sidebar flex flex-1 flex-col overflow-auto"
                  >
                    <div class="grid shrink-0 grid-cols-3 gap-2">
                      <div class="flex items-center justify-start">
                        <TabsList class="bg-transparent p-0">
                          <TabsTrigger
                            v-for="value in source"
                            :key="value.id"
                            class="data-[state=active]:after:bg-primary data-[state=active]:text-foreground hover:text-accent-foreground text-muted-foreground relative h-full rounded-none text-xs uppercase data-[state=active]:!border-transparent data-[state=active]:!bg-transparent data-[state=active]:shadow-none data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-0.5 data-[state=active]:after:h-px"
                            :value="`tab-${value.id}`"
                            @click="setActiveTab(`tab-${value.id}`)"
                          >
                            {{ value.label }}
                          </TabsTrigger>
                        </TabsList>
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
                    <Separator />
                    <TabsContent :value="activeTab" class="size-full pt-2 pl-2">
                      <div ref="terminalEl" class="size-full"></div>
                    </TabsContent>
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
