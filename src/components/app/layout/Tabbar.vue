<script lang="ts" setup>
import {
  IconCheck,
  IconChevronDown,
  IconCircleX,
  IconCopy,
  IconGalleryHorizontalEnd,
  IconHistory,
  IconLayers,
  IconPenLine,
  IconPlus,
  IconSquarePen,
  IconSquareX,
  IconTrash,
  IconX,
} from "@/data/icons"
import { getPlatformSpecialKey } from "@/helpers/shortcuts"
import { isDefaultRoute } from "@/helpers/utilities"
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
  isHydrated,
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
const hasInitialized = ref(false)
const previousRoutePath = ref<string | null>(null)

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
async function handleAddTab(fullPath = "/new", name?: string) {
  const newTab = await addTab(fullPath, name)
  if (newTab) navigateToTab(newTab)
}

// Close a tab with null safety
async function handleCloseTab(id: string | undefined) {
  if (!id) return
  const result = await closeTab(id)
  if (result?.nextPath) {
    router.push(result.nextPath)
  }
}

// Duplicate a tab with null safety
async function handleDuplicateTab(id: string | undefined) {
  if (!id) return
  await duplicateTab(id)
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

  if (isDefaultRoute(tab)) return

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
  [() => route.fullPath, pending, isHydrated],
  async ([fullPath, isPending, hydrated]) => {
    if (isPending || !hydrated) return

    // Check if coming from a non-tabs route (landing pages: /, /pricing, /changelog)
    const comingFromNonTabsRoute =
      previousRoutePath.value !== null &&
      !tabs.value.some((t) => t.fullPath === previousRoutePath.value)

    previousRoutePath.value = fullPath

    // Handle first run after hydration
    if (!hasInitialized.value) {
      hasInitialized.value = true

      const existingTab = tabs.value.find((t) => t.fullPath === fullPath)
      if (existingTab) {
        setActiveTab(existingTab.id)
        return
      }

      if (tabs.value.length > 0) {
        const activeTabMatchesRoute =
          activeTabId.value &&
          tabs.value.find(
            (t) => t.id === activeTabId.value && t.fullPath === fullPath
          )
        if (activeTabMatchesRoute) return

        const newTab = await addTab(
          fullPath,
          (route.meta?.breadcrumb as string) || (route.name as string)
        )
        if (newTab) setActiveTab(newTab.id)
        return
      }

      if (activeTabId.value) return
    }

    if (isSyncing.value) return
    if (!route.name) return

    // If clicked on an existing tab, it's already active
    const clickedTab = tabs.value.find(
      (t) => t.id === activeTabId.value && t.fullPath === fullPath
    )
    if (clickedTab) return

    // Switch to existing tab if route matches
    const existingTab = tabs.value.find((t) => t.fullPath === fullPath)
    if (existingTab) {
      setActiveTab(existingTab.id)
      return
    }

    // Route doesn't exist - create new tab or update active tab
    if (comingFromNonTabsRoute || !activeTabId.value) {
      const newTab = await addTab(
        fullPath,
        (route.meta?.breadcrumb as string) || (route.name as string)
      )
      if (newTab) setActiveTab(newTab.id)
    } else {
      updateActiveTab(
        fullPath,
        (route.meta?.breadcrumb as string) || (route.name as string)
      )
    }
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
  if (keepId) {
    closeOtherTabs(keepId)
  }
}

async function onTabsCloseAll() {
  await closeAllTabs()
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
    <ContextMenuTrigger as-child>
      <div
        data-tauri-drag-region
        class="flex min-w-0 items-stretch gap-2 p-2 transition-all"
      >
        <BackForth />
        <nav
          ref="el"
          class="relative flex min-w-0 items-stretch justify-start gap-2"
        >
          <template v-if="pending">
            <Skeleton v-for="n in 3" :key="n" class="bg-accent h-9 w-60" />
          </template>
          <template v-else-if="tabs.length === 0">
            <Button
              variant="outline"
              class="w-60 min-w-0 shrink-0 justify-start border-dashed shadow-none"
              @click="emitter.emit('Tabs.Add')"
            >
              <IconPlus />
              {{ t("tabs.newTab") }}
            </Button>
          </template>
          <template v-else>
            <div
              v-for="(tab, index) in tabs"
              :key="tab.id"
              class="tab-item w-60 min-w-0 shrink"
              :class="{ 'min-w-40 transition-all': tab.id === activeTabId }"
            >
              <InputGroup v-if="renamingTabId === tab.id">
                <InputGroupAddon>
                  <IconPenLine />
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
                          @dblclick="
                            !isDefaultRoute(tab)
                              ? handleRenameTab(tab.id)
                              : null
                          "
                        >
                          <IconLayers />
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
                                  @click.stop.prevent="handleCloseTab(tab.id)"
                                >
                                  <IconX />
                                </InputGroupButton>
                              </TooltipTrigger>
                              <TooltipContent
                                class="flex items-center gap-2 pr-2"
                              >
                                {{ t("common.close") }}
                                <KbdGroup>
                                  <Kbd>{{ getPlatformSpecialKey() }}</Kbd>
                                  <Kbd>W</Kbd>
                                </KbdGroup>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </RouterLink>
                      </Button>
                    </ContextMenuTrigger>
                    <ContextMenuContent class="w-56">
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
                      <ContextMenuSeparator />
                      <ContextMenuGroup>
                        <ContextMenuItem @click="handleCloseTab(tab.id)">
                          <IconX />
                          {{ t("common.close") }}
                          <ContextMenuShortcut>⌘W</ContextMenuShortcut>
                        </ContextMenuItem>
                        <ContextMenuItem
                          :disabled="tabs.length === 0"
                          @click="emitter.emit('Tabs.Close.All')"
                        >
                          <IconCircleX />
                          {{ t("tabs.closeAll") }}
                          <ContextMenuShortcut>⌘⌥W</ContextMenuShortcut>
                        </ContextMenuItem>
                        <ContextMenuItem
                          :disabled="tabs.length <= 1"
                          @click="emitter.emit('Tabs.Close.Others', tab.id)"
                        >
                          <IconSquareX />
                          {{ t("tabs.closeOthers") }}
                          <ContextMenuShortcut>⌘⇧W</ContextMenuShortcut>
                        </ContextMenuItem>
                      </ContextMenuGroup>
                      <ContextMenuSeparator />
                      <ContextMenuGroup>
                        <ContextMenuItem
                          :disabled="isDefaultRoute(tab)"
                          @click="handleRenameTab(tab.id)"
                        >
                          <IconSquarePen />
                          {{ t("tabs.rename") }}
                          <ContextMenuShortcut>F2</ContextMenuShortcut>
                        </ContextMenuItem>
                        <ContextMenuItem
                          :disabled="isDefaultRoute(tab)"
                          @click="handleDuplicateTab(tab.id)"
                        >
                          <IconCopy />
                          {{ t("tabs.duplicate") }}
                          <ContextMenuShortcut>⌘D</ContextMenuShortcut>
                        </ContextMenuItem>
                      </ContextMenuGroup>
                    </ContextMenuContent>
                  </ContextMenu>
                </HoverCardTrigger>
                <HoverCardContent
                  :side-offset="12"
                  class="flex w-60 flex-col gap-1.5 p-1.5"
                >
                  <div class="flex items-center justify-between px-1.5 py-1">
                    <span class="flex items-center gap-2">
                      <IconLayers />
                      {{ tab.name }}
                    </span>
                    <KbdGroup>
                      <Kbd>{{ getPlatformSpecialKey() }}</Kbd>
                      <Kbd>{{ index + 1 }}</Kbd>
                    </KbdGroup>
                  </div>
                  <div class="bg-secondary aspect-video rounded border"></div>
                </HoverCardContent>
              </HoverCard>
            </div>
          </template>
        </nav>
        <div
          data-tauri-drag-region
          class="flex shrink-0 grow items-stretch justify-between gap-2"
        >
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
                  <DropdownMenuContent align="end" side="bottom">
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
                    <DropdownMenuSeparator />
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
                        :disabled="tabs.length === 0"
                        @click="emitter.emit('Tabs.Close.All')"
                      >
                        <IconCircleX />
                        {{ t("tabs.closeAll") }}
                        <DropdownMenuShortcut>⌘⌥W</DropdownMenuShortcut>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        :disabled="tabs.length <= 1 || !activeTabId"
                        @click="emitter.emit('Tabs.Close.Others', activeTabId)"
                      >
                        <IconSquareX />
                        {{ t("tabs.closeOthers") }}
                        <DropdownMenuShortcut>⌘⇧W</DropdownMenuShortcut>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        :disabled="!activeTabId || isDefaultRoute(activeTab!)"
                        @click="handleRenameTab(activeTabId)"
                      >
                        <IconSquarePen />
                        {{ t("tabs.rename") }}
                        <DropdownMenuShortcut>F2</DropdownMenuShortcut>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        :disabled="!activeTabId || isDefaultRoute(activeTab!)"
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
                            <IconGalleryHorizontalEnd />
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
                            <IconLayers />
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
                            <IconLayers />
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
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem
          :disabled="recentlyClosed.length === 0"
          @click="emitter.emit('Tabs.ReopenLast')"
        >
          <IconHistory />
          {{ t("tabs.reopenLast") }}
          <ContextMenuShortcut>⌘⇧T</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  </ContextMenu>
</template>
