<script lang="ts" setup>
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconCircleX,
  IconCopy,
  IconHash,
  IconHistory,
  IconPlus,
  IconSquarePen,
  IconSquareX,
  IconTrash,
  IconWorkflow,
  IconX,
} from "@/data/icons"
import { emitter } from "@/modules/mitt"
import { useLayoutStore } from "@/stores/layoutStore"
import { useSortable } from "@vueuse/integrations/useSortable"
import { storeToRefs } from "pinia"
import { useRouter } from "vue-router"

const el = ref<HTMLElement | null>(null)
const router = useRouter()
const route = useRoute()
const { t } = useI18n()

const layoutStore = useLayoutStore()
const {
  tabs,
  activeTabId,
  activeTab,
  recentlyClosed,
  isLoading: pending,
} = storeToRefs(layoutStore)

const {
  addTab,
  closeTab,
  closeOtherTabs,
  closeAllTabs,
  duplicateTab,
  renameTab,
  setActiveTab,
  updateActiveTab,
  clearRecentlyClosed,
  reopenLastClosed,
} = layoutStore

const renamingTabId = ref<string | null>(null)
const renamingName = ref("")

// Enable drag-and-drop reordering
useSortable(el, tabs, {
  animation: 150,
  draggable: ".tab-item",
  handle: ".hover-trigger",
})

const isSyncing = ref(false)
const hasHydrated = ref(false)

// Navigate to a tab (used by event handlers and programmatic navigation)
function navigateToTab(tab: { id: string; fullPath: string }) {
  setActiveTab(tab.id)
  router.push(tab.fullPath)
}

// Handle tab click - switch to the clicked tab
function onTabClick(tab: { id: string }) {
  setActiveTab(tab.id)
}

// Add a new tab
function handleAddTab(fullPath = "/new", name?: string) {
  const newTab = addTab(fullPath, name)
  if (newTab) navigateToTab(newTab)
}

// Close a tab with null safety
function handleCloseTab(id: string | undefined) {
  if (!id) return
  const result = closeTab(id)
  if (result?.nextPath) {
    router.push(result.nextPath)
  }
}

// Duplicate a tab with null safety
function handleDuplicateTab(id: string | undefined) {
  if (!id) return
  duplicateTab(id)
  // Ideally navigate to new tab, but store doesn't return it yet.
  // Workaround: find tab with activeTabId
  const newTab = tabs.value.find((t) => t.id === activeTabId.value)
  if (newTab) navigateToTab(newTab)
}

// Rename a tab with null safety
function handleRenameTab(id: string | undefined) {
  if (!id) return
  const tab = tabs.value.find((t) => t.id === id)
  if (!tab) return

  renamingTabId.value = id
  renamingName.value = tab.name

  nextTick(() => {
    const input = el.value?.querySelector("input")
    input?.focus()
    input?.select()
  })
}

function saveRename() {
  if (!renamingTabId.value) return
  renameTab(renamingTabId.value, renamingName.value)
  cancelRename()
}

function cancelRename() {
  renamingTabId.value = null
  renamingName.value = ""
}

// Select tab by ID or direction
function selectTab(idOrDirection: string | number) {
  if (tabs.value.length === 0) return

  let targetId: string

  if (idOrDirection === "next" || idOrDirection === "previous") {
    // Visual order cycling
    const currentIndex = tabs.value.findIndex((t) => t.id === activeTabId.value)
    // If no active tab or not found, start at 0
    const start = currentIndex === -1 ? 0 : currentIndex

    let nextIndex = 0
    if (idOrDirection === "next") {
      nextIndex = (start + 1) % tabs.value.length
    } else {
      nextIndex = (start - 1 + tabs.value.length) % tabs.value.length
    }

    const target = tabs.value[nextIndex]
    if (target) {
      targetId = target.id
    } else {
      return
    }
  } else if (typeof idOrDirection === "number") {
    const tabIdx = Math.max(
      0,
      Math.min(idOrDirection - 1, tabs.value.length - 1)
    )
    const tab = tabs.value[tabIdx]
    if (!tab) return
    targetId = tab.id
  } else {
    targetId = idOrDirection as string
  }

  const target = tabs.value.find((t) => t.id === targetId)
  if (target) navigateToTab(target)
}

// Sync route changes with tabs (Route -> Store)
watch(
  [() => route.fullPath, pending],
  ([fullPath, isPending]) => {
    if (isPending) return

    // If we just hydrated, skip this first run if a store path exists
    // to let the Sync watcher below handle the initial navigation.
    if (!hasHydrated.value) {
      hasHydrated.value = true
      if (activeTab.value?.fullPath && activeTab.value.fullPath !== fullPath) {
        return
      }
    }

    if (isSyncing.value) return
    if (!route.name) return

    // Check if the route change is because we clicked on an existing tab
    const clickedTab = tabs.value.find(
      (t) => t.id === activeTabId.value && t.fullPath === fullPath
    )

    // If we clicked on a tab, don't update anything - tab is already active
    if (clickedTab) return

    // If we have an active tab, update it with the new route (normal navigation)
    if (activeTabId.value) {
      const activeTab = tabs.value.find((t) => t.id === activeTabId.value)
      if (activeTab) {
        updateActiveTab(
          fullPath,
          (route.meta?.breadcrumb as string) ||
            (route.name as string) ||
            activeTab.name
        )
        return
      }
    }

    // No active tab or active tab not found - create a new tab
    const newTab = addTab(
      fullPath,
      (route.meta?.breadcrumb as string) || (route.name as string)
    )
    if (newTab) navigateToTab(newTab)
  },
  { immediate: true }
)

// Sync active tab changes from other sessions with local route (Store -> Route)
watch(
  [activeTabId, () => activeTab.value?.fullPath, pending],
  async ([newId, newPath, isPending]) => {
    if (isPending) return
    if (isSyncing.value) return // Prevent re-entry during active sync

    // Ensure we have current path to compare against
    const currentPath = route.fullPath

    // If no active tab exists (e.g. all tabs closed in another session)
    if (!newId || !newPath) {
      if (tabs.value.length === 0 && currentPath !== "/start") {
        isSyncing.value = true
        try {
          await router.push("/start")
        } finally {
          // Use setTimeout to ensure router has fully settled
          setTimeout(() => {
            isSyncing.value = false
          }, 0)
        }
      }
      return
    }

    // If the local route doesn't match the active tab's route, navigate
    if (currentPath !== newPath) {
      isSyncing.value = true
      try {
        await router.push(newPath)
      } finally {
        // Use setTimeout to ensure router has fully settled
        setTimeout(() => {
          isSyncing.value = false
        }, 0)
      }
    }
  }
)

// Event handlers - store references for cleanup
function onTabsAdd(raw?: unknown) {
  const data = raw as
    | { fullPath?: string; path?: string; url?: string; name?: string }
    | undefined
  const path = data?.fullPath || data?.path || data?.url || "/new"
  handleAddTab(path, data?.name)
}

function onTabsClose(id?: unknown) {
  handleCloseTab((typeof id === "string" ? id : activeTabId.value) || undefined)
}

function onTabsCloseOthers(id?: unknown) {
  const keepId = typeof id === "string" ? id : activeTabId.value
  if (keepId) closeOtherTabs(keepId)
}

function onTabsCloseAll() {
  closeAllTabs()
  router.push("/start")
}

function onTabsSelect(idOrIndex?: unknown) {
  if (typeof idOrIndex === "string" || typeof idOrIndex === "number") {
    selectTab(idOrIndex)
  }
}

function onTabsReopenLast() {
  const last = reopenLastClosed()
  if (last) handleAddTab(last.fullPath, last.name)
}

function onTabsReopen(raw?: unknown) {
  const tab = raw as { fullPath: string; name: string } | undefined
  if (tab) handleAddTab(tab.fullPath, tab.name)
}

function onTabsDuplicate(id?: unknown) {
  handleDuplicateTab(
    (typeof id === "string" ? id : activeTabId.value) || undefined
  )
}

function onTabsRename(id?: unknown) {
  handleRenameTab(
    (typeof id === "string" ? id : activeTabId.value) || undefined
  )
}

// Register event listeners
emitter.on("Tabs.Add", onTabsAdd)
emitter.on("Tabs.Close", onTabsClose)
emitter.on("Tabs.Close.Others", onTabsCloseOthers)
emitter.on("Tabs.Close.All", onTabsCloseAll)
emitter.on("Tabs.Select", onTabsSelect)
emitter.on("Tabs.ReopenLast", onTabsReopenLast)
emitter.on("Tabs.Reopen", onTabsReopen)
emitter.on("Tabs.Duplicate", onTabsDuplicate)
emitter.on("Tabs.Rename", onTabsRename)

// Cleanup event listeners on unmount to prevent memory leaks
onUnmounted(() => {
  emitter.off("Tabs.Add", onTabsAdd)
  emitter.off("Tabs.Close", onTabsClose)
  emitter.off("Tabs.Close.Others", onTabsCloseOthers)
  emitter.off("Tabs.Close.All", onTabsCloseAll)
  emitter.off("Tabs.Select", onTabsSelect)
  emitter.off("Tabs.ReopenLast", onTabsReopenLast)
  emitter.off("Tabs.Reopen", onTabsReopen)
  emitter.off("Tabs.Duplicate", onTabsDuplicate)
  emitter.off("Tabs.Rename", onTabsRename)
})
</script>

<template>
  <ContextMenu>
    <div class="bg-background flex w-full flex-col">
      <ContextMenuTrigger as-child>
        <div
          data-tauri-drag-region
          class="flex grow items-stretch gap-2 p-2 transition-all"
        >
          <div class="flex items-stretch justify-start gap-2">
            <ButtonGroup>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="secondary"
                      size="icon"
                      @click="router.go(-1)"
                    >
                      <IconArrowLeft />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent> {{ t("tabs.goBack") }} </TooltipContent>
                </Tooltip>
                <ButtonGroupSeparator />
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="secondary"
                      size="icon"
                      @click="router.go(1)"
                    >
                      <IconArrowRight />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent> {{ t("tabs.goForward") }} </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </ButtonGroup>
          </div>
          <nav
            ref="el"
            class="relative flex min-w-0 items-stretch justify-center"
            :class="tabs.length === 0 ? 'hidden' : 'gap-2'"
          >
            <template v-if="pending">
              <Skeleton v-for="n in 3" :key="n" class="bg-accent h-9 w-60" />
            </template>
            <!-- <template v-else-if="tabs.length === 0">
              <Button
                variant="ghost"
                size="icon"
                @click="emitter.emit('Tabs.Add')"
              >
                <IconCircle />
              </Button>
            </template> -->
            <template v-else>
              <div
                v-for="tab in tabs"
                :key="tab.id"
                class="tab-item w-60 min-w-0"
                :class="{ 'min-w-40 transition-all': tab.id === activeTabId }"
              >
                <InputGroup v-if="renamingTabId === tab.id">
                  <InputGroupAddon>
                    <IconWorkflow />
                  </InputGroupAddon>
                  <InputGroupInput
                    v-model="renamingName"
                    :placeholder="tab.name"
                    @keydown.enter="saveRename"
                    @keydown.esc="cancelRename"
                  />
                  <InputGroupAddon align="inline-end">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <InputGroupButton
                            variant="secondary"
                            size="icon-xs"
                            @click.prevent="saveRename"
                          >
                            <IconCheck />
                          </InputGroupButton>
                        </TooltipTrigger>
                        <TooltipContent>{{ t("common.save") }}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </InputGroupAddon>
                </InputGroup>
                <HoverCard v-else :open-delay="2000" :close-delay="0">
                  <HoverCardTrigger class="hover-trigger">
                    <ContextMenu>
                      <ContextMenuTrigger as-child class="context-trigger">
                        <Button
                          :variant="
                            tab.id === activeTabId ? 'secondary' : 'ghost'
                          "
                          class="group w-[-webkit-fill-available] min-w-0 pr-1.5!"
                          :class="
                            tab.id === activeTabId
                              ? 'text-foreground shadow-none'
                              : 'text-secondary-foreground/50 bg-secondary/50'
                          "
                          as-child
                        >
                          <RouterLink
                            :to="tab.fullPath"
                            @click="onTabClick(tab)"
                            @dblclick="handleRenameTab(tab.id)"
                          >
                            <IconWorkflow />
                            <span class="mr-auto truncate">
                              {{ tab.name }}
                            </span>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger as-child>
                                  <InputGroupButton
                                    variant="ghost"
                                    size="icon-xs"
                                    class="invisible group-hover:visible"
                                    @click.prevent="handleCloseTab(tab.id)"
                                  >
                                    <IconX />
                                  </InputGroupButton>
                                </TooltipTrigger>
                                <TooltipContent>{{
                                  t("common.close")
                                }}</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </RouterLink>
                        </Button>
                      </ContextMenuTrigger>
                      <ContextMenuContent class="w-56">
                        <ContextMenuGroup>
                          <ContextMenuItem @click="handleCloseTab(tab.id)">
                            <IconX />
                            {{ t("common.close") }}
                            <ContextMenuShortcut>⌘W</ContextMenuShortcut>
                          </ContextMenuItem>
                          <ContextMenuItem
                            :disabled="tabs.length <= 1"
                            @click="emitter.emit('Tabs.Close.Others', tab.id)"
                          >
                            <IconCircleX />
                            {{ t("tabs.closeOthers") }}
                            <ContextMenuShortcut>⌘⇧W</ContextMenuShortcut>
                          </ContextMenuItem>
                          <ContextMenuItem
                            :disabled="tabs.length === 0"
                            @click="emitter.emit('Tabs.Close.All')"
                          >
                            <IconSquareX />
                            {{ t("tabs.closeAll") }}
                            <ContextMenuShortcut>⌘⌥W</ContextMenuShortcut>
                          </ContextMenuItem>
                        </ContextMenuGroup>
                        <ContextMenuSeparator />
                        <ContextMenuGroup>
                          <ContextMenuItem @click="handleRenameTab(tab.id)">
                            <IconSquarePen />
                            {{ t("tabs.rename") }}
                            <ContextMenuShortcut>F2</ContextMenuShortcut>
                          </ContextMenuItem>
                          <ContextMenuItem @click="handleDuplicateTab(tab.id)">
                            <IconCopy />
                            {{ t("tabs.duplicate") }}
                            <ContextMenuShortcut>⌘D</ContextMenuShortcut>
                          </ContextMenuItem>
                        </ContextMenuGroup>
                        <ContextMenuSeparator />
                        <ContextMenuGroup>
                          <ContextMenuItem
                            as-child
                            @click="emitter.emit('Tabs.Add')"
                          >
                            <RouterLink to="/new">
                              <IconPlus />
                              {{ t("tabs.newTab") }}
                              <ContextMenuShortcut>⌘T</ContextMenuShortcut>
                            </RouterLink>
                          </ContextMenuItem>
                        </ContextMenuGroup>
                      </ContextMenuContent>
                    </ContextMenu>
                  </HoverCardTrigger>
                  <HoverCardContent
                    class="grid w-60 grid-cols-1 p-0"
                    :side-offset="12"
                  >
                    <div class="flex flex-col p-3">
                      <span class="font-medium">
                        {{ tab.name }}
                      </span>
                      <span class="text-secondary-foreground text-xs">
                        {{ tab.fullPath }}
                      </span>
                    </div>
                    <Separator />
                    <div
                      class="bg-accent/50 text-muted-foreground flex items-center gap-2 rounded-b-md p-2"
                    >
                      <IconHash />
                      <span class="truncate">{{ tab.id }}</span>
                    </div>
                  </HoverCardContent>
                </HoverCard>
              </div>
            </template>
          </nav>
          <div class="flex grow items-stretch justify-between gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon"
                    as-child
                    @click="emitter.emit('Tabs.Add')"
                  >
                    <RouterLink to="/new">
                      <IconPlus />
                    </RouterLink>
                  </Button>
                </TooltipTrigger>
                <TooltipContent> {{ t("tabs.newTab") }} </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <div class="flex items-stretch justify-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  <DropdownMenu>
                    <TooltipTrigger as-child>
                      <DropdownMenuTrigger as-child>
                        <Button variant="secondary" size="icon">
                          <IconChevronDown />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent> {{ t("tabs.options") }} </TooltipContent>
                    <DropdownMenuContent class="w-56" align="end" side="bottom">
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          :disabled="!activeTabId"
                          @click="handleCloseTab(activeTabId)"
                        >
                          <IconX />
                          {{ t("common.close") }}
                          <DropdownMenuShortcut>⌘W</DropdownMenuShortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          :disabled="tabs.length <= 1 || !activeTabId"
                          @click="
                            emitter.emit('Tabs.Close.Others', activeTabId)
                          "
                        >
                          <IconCircleX />
                          {{ t("tabs.closeOthers") }}
                          <DropdownMenuShortcut>⌘⇧W</DropdownMenuShortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          :disabled="tabs.length === 0"
                          @click="emitter.emit('Tabs.Close.All')"
                        >
                          <IconSquareX />
                          {{ t("tabs.closeAll") }}
                          <DropdownMenuShortcut>⌘⌥W</DropdownMenuShortcut>
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          :disabled="!activeTabId"
                          @click="handleRenameTab(activeTabId)"
                        >
                          <IconSquarePen />
                          {{ t("tabs.rename") }}
                          <DropdownMenuShortcut>F2</DropdownMenuShortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          :disabled="!activeTabId"
                          @click="handleDuplicateTab(activeTabId)"
                        >
                          <IconCopy />
                          {{ t("tabs.duplicate") }}
                          <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuSub>
                          <DropdownMenuItem as-child>
                            <DropdownMenuSubTrigger>
                              <IconWorkflow />
                              {{ t("tabs.activeTabs") }}
                            </DropdownMenuSubTrigger>
                          </DropdownMenuItem>
                          <DropdownMenuSubContent class="w-56">
                            <DropdownMenuLabel
                              v-if="tabs.length === 0"
                              class="text-muted-foreground text-xs"
                            >
                              {{ t("tabs.activeTabsEmpty") }}
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                              v-for="tab in tabs"
                              :key="tab.id"
                              @click="emitter.emit('Tabs.Select', tab.id)"
                            >
                              <IconWorkflow />
                              {{ tab.name }}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              :disabled="tabs.length === 0"
                              @click="emitter.emit('Tabs.Close.All')"
                            >
                              <IconTrash />
                              {{ t("tabs.closeAllTabs") }}
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSub>
                          <DropdownMenuItem as-child>
                            <DropdownMenuSubTrigger>
                              <IconHistory />
                              {{ t("tabs.recentClosedTabs") }}
                            </DropdownMenuSubTrigger>
                          </DropdownMenuItem>
                          <DropdownMenuSubContent class="w-56">
                            <DropdownMenuLabel
                              v-if="recentlyClosed.length === 0"
                              class="text-muted-foreground text-xs"
                            >
                              {{ t("tabs.recentlyClosedEmpty") }}
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                              v-for="tab in recentlyClosed"
                              :key="tab.id + tab.fullPath"
                              @click="emitter.emit('Tabs.Reopen', tab)"
                            >
                              <IconWorkflow />
                              {{ tab.name }}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              :disabled="recentlyClosed.length === 0"
                              @click="clearRecentlyClosed"
                            >
                              <IconTrash />
                              {{ t("tabs.clearRecent") }}
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          as-child
                          @click="emitter.emit('Tabs.Add')"
                        >
                          <RouterLink to="/new">
                            <IconPlus />
                            {{ t("tabs.newTab") }}
                            <DropdownMenuShortcut>⌘T</DropdownMenuShortcut>
                          </RouterLink>
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent class="w-56" align="start" side="bottom">
        <ContextMenuGroup>
          <ContextMenuItem as-child @click="emitter.emit('Tabs.Add')">
            <RouterLink to="/new">
              <IconPlus />
              {{ t("tabs.newTab") }}
              <ContextMenuShortcut>⌘T</ContextMenuShortcut>
            </RouterLink>
          </ContextMenuItem>
          <ContextMenuItem
            :disabled="recentlyClosed.length === 0"
            @click="emitter.emit('Tabs.ReopenLast')"
          >
            <IconHistory />
            {{ t("tabs.reopenLast") }}
            <ContextMenuShortcut>⌘⇧T</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem
            :disabled="tabs.length === 0"
            @click="emitter.emit('Tabs.Close.All')"
          >
            <IconSquareX />
            {{ t("tabs.closeAll") }}
            <ContextMenuShortcut>⌘⌥W</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </div>
    <Separator />
  </ContextMenu>
</template>
